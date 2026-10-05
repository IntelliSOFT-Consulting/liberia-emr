/**
 * O3 passes an ExtensionSlot's `state` to the extension as its props (not as `props.state`).
 * Accept both so the components work however the slot is rendered.
 */
export function readSlotProps<T extends object>(props: T & { state?: Partial<T> }): T {
  return { ...(props.state ?? {}), ...props } as T;
}
