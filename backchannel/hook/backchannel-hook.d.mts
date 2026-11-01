// Types for the plain-JS hook relay, so the tests can import it.
export function trim(event: Record<string, unknown>): Record<string, any>;
export function render(eventName: string, text: string | null | undefined): Record<string, unknown> | null;
export function relay(agent: string, raw: string): Promise<Record<string, unknown> | null>;
