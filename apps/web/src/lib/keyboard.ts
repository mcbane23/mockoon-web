/** True when the event target is a text field or an editor, where shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;

  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('.cm-editor') !== null
  );
}

export const isModifier = (event: KeyboardEvent | React.KeyboardEvent): boolean =>
  event.ctrlKey || event.metaKey;
