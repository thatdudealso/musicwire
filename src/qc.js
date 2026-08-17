import { spawn } from 'node:child_process';

export const failureCodes = {
  validation: 'validation_failed',
  renderer: 'renderer_failed',
  timeout: 'renderer_timeout',
  memory: 'renderer_memory_limit',
  cpu: 'renderer_cpu_limit',
  artifacts: 'artifact_missing',
  audioProbe: 'audio_probe_unavailable',
  audioInvalid: 'audio_invalid',
  audioSilent: 'audio_silent',
  duration: 'audio_duration_mismatch',
  scoreDuration: 'score_duration_unavailable',
  constraints: 'constraints_mismatch',
  interrupted: 'render_interrupted',
};

export function checkAudioDuration(expectedSeconds, actualSeconds, tailAllowanceSeconds = 0) {
  if (!(expectedSeconds > 0)) return { ok: true };
  const tolerance = expectedSeconds * 0.1;
  const shortfall = expectedSeconds - actualSeconds;
  const overrun = actualSeconds - expectedSeconds - Math.max(0, tailAllowanceSeconds);
  if (shortfall <= tolerance && overrun <= tolerance) return { ok: true };
  return {
    ok: false,
    code: failureCodes.duration,
    message: `Audio duration ${actualSeconds.toFixed(2)}s differs from score duration ${expectedSeconds.toFixed(2)}s by more than 10% beyond the ${Math.max(0, tailAllowanceSeconds)}s release-tail allowance.`,
    details: { expected_seconds: expectedSeconds, actual_seconds: actualSeconds, tail_allowance_seconds: Math.max(0, tailAllowanceSeconds) },
  };
}

export async function probeAudio(ffprobeBin, filename) {
  const args = ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name', '-of', 'json', filename];
  try {
    const { stdout, code } = await command(ffprobeBin, args, 15_000);
    if (code !== 0) return { ok: false, code: failureCodes.audioInvalid, message: 'ffprobe could not read the audio container.' };
    const output = JSON.parse(stdout);
    const duration = Number(output.format?.duration);
    const audioStream = output.streams?.find((stream) => stream.codec_type === 'audio');
    if (!audioStream || !Number.isFinite(duration) || duration <= 0) return { ok: false, code: failureCodes.audioInvalid, message: 'Audio has no playable stream or duration.' };
    return { ok: true, duration, codec: audioStream.codec_name, container: output.format?.format_name };
  } catch (error) {
    return { ok: false, code: failureCodes.audioProbe, message: `ffprobe is unavailable: ${error.message}` };
  }
}

export async function verifyNonSilent(ffmpegBin, filename) {
  try {
    const { stderr, code } = await command(ffmpegBin, ['-v', 'info', '-i', filename, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], 20_000);
    if (code !== 0) return { ok: false, code: failureCodes.audioInvalid, message: 'ffmpeg could not decode the audio stream.' };
    const rms = Number(stderr.match(/RMS level dB:\s*(-?[\d.]+|-inf)/i)?.[1]);
    if (!Number.isFinite(rms) || rms < -90) return { ok: false, code: failureCodes.audioSilent, message: 'Audio RMS is silent or below the -90 dB acceptance threshold.' };
    return { ok: true, rmsDb: rms };
  } catch (error) {
    return { ok: false, code: failureCodes.audioProbe, message: `ffmpeg is unavailable: ${error.message}` };
  }
}

export function compareConstraints(facts, constraints = {}) {
  const mismatches = [];
  if (constraints.tempo && Math.abs(Number(constraints.tempo) - facts.tempo) > 1) mismatches.push('tempo');
  if (constraints.duration_seconds && Math.abs(Number(constraints.duration_seconds) - facts.scoreDurationSeconds) > Math.max(1, Number(constraints.duration_seconds) * 0.1)) mismatches.push('duration_seconds');
  if (constraints.key_fifths !== undefined && Number(constraints.key_fifths) !== facts.key.fifths) mismatches.push('key_fifths');
  if (constraints.mode && constraints.mode !== facts.key.mode) mismatches.push('mode');
  return mismatches;
}

function command(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: 124, stdout, stderr }); }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
