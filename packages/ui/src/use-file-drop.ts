import { useEffect, useEffectEvent, useState } from 'react';

/**
 * Takes provider files dropped anywhere on the window while mounted. Returns whether a file is over the
 * window, for a cover that says what dropping does.
 */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  // The window listeners stay subscribed for the component's lifetime and always call the latest handler.
  const onDrop = useEffectEvent(onFiles);
  useEffect(() => {
    let depth = 0; // dragenter/leave fire for every element crossed, so count them
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setOver(false);
      }
    };
    const dragOver = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setOver(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) {
        onDrop(files);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}
