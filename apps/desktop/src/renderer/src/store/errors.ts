/** An error's message for the user, without the "Error invoking remote method '…': Error:" Electron adds to main's errors. */
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(error);
