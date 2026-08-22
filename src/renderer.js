import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { embedAttribution, embedMusicXmlAttribution } from './attribution.js';
import { noticeText } from './notice.js';
import { verificationUrl } from './provenance.js';
import {
  checkAudioDuration,
  probeAudio,
  verifyNonSilent,
  compareConstraints,
  failureCodes,
} from './qc.js';

const extensionFor = {
  midi: 'mid',
  mscz: 'mscz',
  pdf: 'pdf',
  svg: 'svg',
  png: 'png',
  mp3: 'mp3',
  wav: 'wav',
};

export class Renderer {
  constructor(config, artifactStore) {
    this.config = config;
    this.artifactStore = artifactStore;
  }

  async render(job) {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), `musicwire-${job.id.replaceAll(/[^a-zA-Z0-9-]/g, '')}-`),
    );
    try {
      const input = path.join(workspace, 'source.musicxml');
      fs.writeFileSync(input, job.inputXml, { mode: 0o600 });
      const provenance = {
        receiptId: job.renderReceiptId,
        verificationUrl: verificationUrl(this.config.publicBaseUrl),
      };
      const rendered = [];
      for (const format of job.formats) {
        const stem = path.join(workspace, 'score');
        const output = `${stem}.${extensionFor[format]}`;
        const result = await this.#runMuseScore(input, output, workspace);
        if (result.timedOut)
          return failed(failureCodes.timeout, 'MuseScore exceeded the render wall-time limit.');
        if (result.memoryExceeded)
          return failed(failureCodes.memory, 'MuseScore exceeded the render RSS limit.');
        if (result.cpuExceeded)
          return failed(failureCodes.cpu, 'MuseScore exceeded the render CPU-time limit.');
        if (result.code !== 0)
          return failed(
            failureCodes.renderer,
            `MuseScore exited ${result.code}: ${result.stderr.slice(0, 500)}`,
          );
        const files =
          format === 'svg' || format === 'png'
            ? fs
                .readdirSync(workspace)
                .filter((name) => new RegExp(`^score-\\d+\\.${extensionFor[format]}$`).test(name))
                .sort()
            : [path.basename(output)];
        if (files.length === 0 || files.some((name) => !fs.existsSync(path.join(workspace, name))))
          return failed(
            failureCodes.artifacts,
            `MuseScore did not create the requested ${format} artifact.`,
          );
        for (const file of files)
          rendered.push({ name: file, format, path: path.join(workspace, file) });
      }
      const audioFailure = await this.#checkAudio(rendered, job.facts.scoreDurationSeconds);
      if (audioFailure) return audioFailure;
      const mismatches = compareConstraints(job.facts, job.constraints);
      if (mismatches.length)
        return failed(
          failureCodes.constraints,
          `Score does not meet requested constraints: ${mismatches.join(', ')}.`,
          { mismatches },
        );
      for (const artifact of rendered)
        await embedAttribution({
          file: artifact.path,
          format: artifact.format,
          receiptId: provenance.receiptId,
          verificationUrl: provenance.verificationUrl,
          ffmpegBin: this.config.ffmpegBin,
        });
      const source = embedMusicXmlAttribution(
        Buffer.from(job.inputXml),
        provenance.receiptId,
        provenance.verificationUrl,
      );
      const receipt = await this.#receipt(job);
      const artifacts = await Promise.all([
        this.artifactStore.put('source.musicxml', source),
        ...rendered.map((item) => this.artifactStore.put(item.name, fs.readFileSync(item.path))),
        this.artifactStore.put(
          'NOTICE.txt',
          Buffer.from(noticeText(this.config.soundfontLicensePath, provenance)),
        ),
      ]);
      return { ok: true, artifacts, receipt };
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 2 });
    }
  }

  async #checkAudio(rendered, expectedDuration) {
    for (const audio of rendered.filter((item) => item.format === 'mp3' || item.format === 'wav')) {
      const probe = await probeAudio(this.config.ffprobeBin, audio.path);
      if (!probe.ok) return failed(probe.code, probe.message);
      const silence = await verifyNonSilent(this.config.ffmpegBin, audio.path);
      if (!silence.ok) return failed(silence.code, silence.message);
      const duration = checkAudioDuration(
        expectedDuration,
        probe.duration,
        this.config.audioTailAllowanceSeconds,
      );
      if (!duration.ok) return failed(duration.code, duration.message, duration.details);
    }
    return null;
  }

  async #receipt(job) {
    const rendererVersion = await this.#version();
    const soundfontSha256 =
      this.config.soundfontPath && fs.existsSync(this.config.soundfontPath)
        ? crypto
            .createHash('sha256')
            .update(fs.readFileSync(this.config.soundfontPath))
            .digest('hex')
        : null;
    return {
      rendered_by: 'Musicwire',
      repository: 'https://github.com/thatdudealso/musicwire',
      job_id: job.id,
      renderer: {
        version: rendererVersion,
        executable: this.config.mscoreBin,
        sound_profile: 'MuseScore Basic',
        soundfont_sha256: soundfontSha256,
      },
      license: {
        customer_owns_composition: true,
        commercial_audio_use_with_notice: true,
        copyright_sold: false,
      },
      created_at: new Date().toISOString(),
    };
  }

  async #version() {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-version-'));
    try {
      const result = await this.#run(['--version'], workspace);
      return result.code === 0 ? result.stdout.trim() : 'unavailable';
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  async #runMuseScore(input, output, workspace) {
    if (path.extname(output) === '.wav') {
      const mp3Output = `${output}.mp3`;
      try {
        const result = await this.#run(
          ['-f', '--sound-profile', 'MuseScore Basic', '-o', mp3Output, input],
          workspace,
        );
        if (result.code !== 0) return result;
        try {
          execFileSync(this.config.ffmpegBin, ['-y', '-i', mp3Output, output], {
            stdio: 'pipe',
          });
          return result;
        } catch (error) {
          return {
            ...result,
            code: error.status ?? 1,
            stderr: error.stderr?.toString() ?? error.message,
          };
        }
      } finally {
        fs.rmSync(mp3Output, { force: true });
      }
    }
    return this.#run(['-f', '--sound-profile', 'MuseScore Basic', '-o', output, input], workspace);
  }

  #run(args, workspace) {
    const executable = this.config.mscoreArch ? 'arch' : this.config.mscoreBin;
    const commandArgs = this.config.mscoreArch
      ? [`-${this.config.mscoreArch}`, this.config.mscoreBin, ...args]
      : args;
    const environment = {
      ...process.env,
      HOME: workspace,
      MUSESCORE_USER_DATA_DIR: path.join(workspace, 'user-data'),
      MUSESCORE_PLUGIN_PATH: path.join(workspace, 'plugins-disabled'),
    };
    return new Promise((resolve) => {
      const child = spawn(executable, commandArgs, {
        cwd: workspace,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let done = false;
      let memoryExceeded = false;
      let cpuExceeded = false;
      const finish = (result) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          clearInterval(memoryCheck);
          resolve(result);
        }
      };
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ code: 124, stdout, stderr, timedOut: true });
      }, this.config.maxRenderSeconds * 1_000);
      const memoryCheck = setInterval(() => {
        if (process.platform !== 'linux' && process.platform !== 'darwin') return;
        try {
          const rss =
            process.platform === 'linux'
              ? Number(
                  fs
                    .readFileSync(`/proc/${child.pid}/status`, 'utf8')
                    .match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0,
                )
              : Number(
                  execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)], {
                    encoding: 'utf8',
                  }).trim() ?? 0,
                );
          if (rss > this.config.maxRenderRssKb) {
            memoryExceeded = true;
            child.kill('SIGKILL');
          }
          const cpu = execFileSync('/bin/ps', ['-o', 'cputime=', '-p', String(child.pid)], {
            encoding: 'utf8',
          }).trim();
          const seconds = cpu
            .split(':')
            .reverse()
            .reduce((total, piece, index) => total + Number(piece) * 60 ** index, 0);
          if (seconds > this.config.maxRenderCpuSeconds) {
            cpuExceeded = true;
            child.kill('SIGKILL');
          }
        } catch {
          if (child.exitCode === null && child.signalCode === null) {
            cpuExceeded = true;
            child.kill('SIGKILL');
          }
        }
      }, 250);
      child.stdout.on('data', (data) => {
        stdout += data;
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      child.once('error', (error) =>
        finish({
          code: 127,
          stdout,
          stderr: `${stderr}${error.message}`,
          timedOut: false,
          memoryExceeded,
          cpuExceeded,
        }),
      );
      child.once('close', (code) =>
        finish({ code, stdout, stderr, timedOut: false, memoryExceeded, cpuExceeded }),
      );
    });
  }
}

function failed(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}
