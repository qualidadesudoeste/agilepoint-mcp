type PendingEntry<T> = { expiresAt: number; value: T; bytes?: number };

export class BoundedPendingStore<T> {
  private readonly entries = new Map<string, Required<PendingEntry<T>>>();

  set(token: string, entry: PendingEntry<T>): void {
    this.sweep();
    const bytes = Buffer.byteLength(JSON.stringify(entry.value), "utf8");
    const maxCount = configuredInteger("APF_MAX_PENDING_SIMULATIONS", 20, 1, 200);
    const maxBytes = configuredInteger("APF_MAX_PENDING_SIMULATION_BYTES", 10 * 1024 * 1024, 1024, 100 * 1024 * 1024);
    const currentBytes = [...this.entries.values()].reduce((total, item) => total + item.bytes, 0);
    if (this.entries.size >= maxCount || currentBytes + bytes > maxBytes) {
      throw new Error("O limite de simulações pendentes foi atingido. Conclua ou aguarde a expiração das solicitações atuais.");
    }
    this.entries.set(token, { ...entry, bytes });
  }

  get(token: string): PendingEntry<T> | undefined {
    this.sweep();
    return this.entries.get(token);
  }

  delete(token: string): boolean {
    return this.entries.delete(token);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}

function configuredInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}
