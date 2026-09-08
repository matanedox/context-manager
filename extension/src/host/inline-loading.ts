/** Small state machine that keeps inline loading visible long enough to avoid flicker. */
import type { LoadingView } from "../present/ui";

export type { LoadingView };

export class InlineLoading {
  current?: LoadingView;
  private nextToken = 0;

  constructor(private readonly onChange: () => void) {}

  begin(label: string, conversationId?: string): number {
    const token = ++this.nextToken;
    this.current = { token, label, conversationId, startedAt: Date.now() };
    this.onChange();
    return token;
  }

  update(token: number, label: string, conversationId?: string): void {
    if (this.current?.token !== token) return;
    const next = { ...this.current, label, conversationId };
    const idChanged = next.conversationId !== this.current.conversationId;
    this.current = next;
    if (idChanged) this.onChange();
  }

  /** Keep the loader up for its minimum without clearing it, so a caller can work underneath it. */
  async hold(token: number, minimumMs = 350): Promise<void> {
    const loading = this.current;
    if (!loading || loading.token !== token) return;
    const remaining = minimumMs - (Date.now() - loading.startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  /** Clear and paint the finished state before the caller is allowed to focus the chat. */
  async finish(token: number, minimumMs = 350): Promise<boolean> {
    if (this.current?.token !== token) return false;
    await this.hold(token, minimumMs);
    if (this.current?.token !== token) return false;
    this.current = undefined;
    this.onChange();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  }
}
