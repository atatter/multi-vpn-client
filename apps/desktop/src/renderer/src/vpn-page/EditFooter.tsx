import { danger, link, primary } from '@repo/ui/tokens.ts';

/**
 * The page's action bar while there are unsaved changes: Save and Discard, or, when the user tries to
 * leave, whether to discard them.
 */
export function EditFooter({
  confirmingLeave,
  reconnects,
  saving,
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  confirmingLeave: boolean;
  reconnects: boolean;
  saving: boolean;
  onSave: () => void;
  /** Throws the changes away (and, when confirming a leave, goes on). */
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  if (confirmingLeave) {
    return (
      <>
        <span className="text-ink">Discard your changes?</span>
        <span className="flex items-center gap-4">
          <button type="button" className={link} onClick={onKeepEditing}>
            Keep editing
          </button>
          <button type="button" className={danger} onClick={onDiscard}>
            Discard
          </button>
        </span>
      </>
    );
  }
  return (
    <>
      <span>{reconnects ? 'Saving reconnects this VPN' : 'Unsaved changes'}</span>
      <span className="flex items-center gap-4">
        <button type="button" className={link} onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className={primary} disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </span>
    </>
  );
}
