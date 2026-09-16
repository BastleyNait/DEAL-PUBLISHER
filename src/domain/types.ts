/** Un renglón de la tabla `publications` (proyecto DEAL HUNTER) listo para postear. */
export interface PublishJob {
  itemId: string;
  ebayUrl: string;
  title: string;
  description: string;
  priceUsd: number;
  /** Precio en soles: es el que va en el campo Price de Facebook, no priceUsd (la cuenta está en Perú). */
  pricePen: number;
  currency: string;
  imageUrls: string[];
}

/** Puerto: de dónde salen los jobs pendientes y cómo se marca el resultado. */
export interface JobQueue {
  /** El más viejo en cola, o null si no hay nada para postear ahora. */
  claimNext(): Promise<PublishJob | null>;
  markPosted(itemId: string): Promise<void>;
  markFailed(itemId: string, error: string): Promise<void>;
}

/** Puerto: postear un job en Facebook Marketplace. Un driver por implementación (hoy Playwright). */
export interface MarketplaceDriver {
  post(job: PublishJob): Promise<void>;
  close(): Promise<void>;
}
