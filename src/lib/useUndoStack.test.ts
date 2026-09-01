import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoStack } from "./useUndoStack";

describe("useUndoStack", () => {
  it("should initialize with empty past and future", () => {
    const { result } = renderHook(() => useUndoStack<number>());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("should push actions to past", () => {
    const { result } = renderHook(() => useUndoStack<number>());
    
    act(() => {
      result.current.push(1);
    });
    
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("should undo and redo correctly", () => {
    const { result } = renderHook(() => useUndoStack<number>());
    
    act(() => {
      result.current.push(1);
      result.current.push(2);
    });
    
    let undone;
    act(() => {
      undone = result.current.undo();
    });
    
    expect(undone).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    
    let redone;
    act(() => {
      redone = result.current.redo();
    });
    
    expect(redone).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("pushing clears future", () => {
    const { result } = renderHook(() => useUndoStack<number>());
    
    act(() => {
      result.current.push(1);
      result.current.push(2);
    });
    
    act(() => {
      result.current.undo();
    });
    
    expect(result.current.canRedo).toBe(true);
    
    act(() => {
      result.current.push(3);
    });
    
    expect(result.current.canRedo).toBe(false);
  });

  it("caps history at 50", () => {
    const { result } = renderHook(() => useUndoStack<number>());
    
    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.push(i);
      }
    });
    
    // Attempting to undo more than 50 times should eventually return null
    let undoCount = 0;
    for (let i = 0; i < 55; i++) {
      let undone;
      act(() => {
        undone = result.current.undo();
      });
      if (undone !== null) undoCount++;
    }
    
    expect(undoCount).toBe(50);
  });
});
