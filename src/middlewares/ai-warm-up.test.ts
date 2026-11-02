import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createAiWarmUp } from './ai-warm-up.js';

const req = {} as Request;
const res = {} as Response;

describe('createAiWarmUp', () => {
  it('starts waking the AI service up and goes on at once', () => {
    const wakeUp = vi.fn();
    const next = vi.fn() as NextFunction;

    createAiWarmUp({ wakeUp })(req, res, next);

    expect(wakeUp).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('never stops the map answer, even if waking up fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const next = vi.fn() as NextFunction;

    createAiWarmUp({
      wakeUp: () => {
        throw new Error('boom');
      },
    })(req, res, next);

    expect(next).toHaveBeenCalledWith();
    vi.restoreAllMocks();
  });
});
