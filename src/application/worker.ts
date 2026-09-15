import type { JobQueue, MarketplaceDriver } from "../domain/types.js";

/**
 * Bucle: pedir el siguiente job en cola, postearlo, marcar el resultado,
 * repetir. Un job que falla no frena el worker — se marca 'failed' con el
 * motivo (columna facebook_error) y se sigue con el siguiente, así un
 * selector roto en una publicación no traba las demás.
 */
export class PublishWorker {
  constructor(
    private readonly queue: JobQueue,
    private readonly driver: MarketplaceDriver,
    private readonly pollIntervalMs: number,
  ) {}

  async runForever(): Promise<never> {
    console.log(`Worker arrancado. Revisando la cola cada ${this.pollIntervalMs / 1000}s. Ctrl+C para salir.`);
    for (;;) {
      await this.drainQueue();
      await sleep(this.pollIntervalMs);
    }
  }

  /** Procesa todo lo que haya en cola ahora mismo, sin esperar. Útil para pruebas. */
  async drainQueue(): Promise<number> {
    let processed = 0;
    for (;;) {
      const job = await this.queue.claimNext();
      if (!job) return processed;

      console.log(`Publicando ${job.itemId} — ${job.title}`);
      try {
        await this.driver.post(job);
        await this.queue.markPosted(job.itemId);
        console.log(`✅ ${job.itemId} publicado.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ ${job.itemId} falló: ${message}`);
        await this.queue.markFailed(job.itemId, message);
      }
      processed++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
