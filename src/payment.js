// Phase 1 deliberately has no payment credentials. The interface ensures capture remains downstream of QC.
export class PaymentService {
  async createPendingCharge({ jobId, priceUsd }) {
    return {
      provider: 'stub',
      status: 'pending_qc',
      job_id: jobId,
      amount_usd: priceUsd,
      captured_at: null,
    };
  }

  async captureAfterQc(payment) {
    if (payment.status !== 'pending_qc')
      throw new Error('Payment capture is only permitted after pending QC.');
    return { ...payment, status: 'capture_stubbed', captured_at: new Date().toISOString() };
  }

  async cancelNotCharged(payment, reason) {
    return { ...payment, status: 'not_charged', reason, captured_at: null };
  }
}
