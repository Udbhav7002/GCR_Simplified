import { useState, useCallback } from "react";

export function useUndoStack<T>() {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const push = useCallback((action: T) => {
    setPast((p) => [...p, action]);
    setFuture([]);
  }, []);

  const undo = useCallback((): T | null => {
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, p.length - 1));
    setFuture((f) => [previous, ...f]);
    return previous;
  }, [past]);

  const redo = useCallback((): T | null => {
    if (future.length === 0) return null;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, next]);
    return next;
  }, [future]);

  return { push, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
