import { describe, expect, it } from 'vitest';
import { interpretOneway } from './oneway.js';

describe('interpretOneway', () => {
  it.each([['yes'], ['true'], ['1'], [' YES ']])('oneway=%s follows the node order', (value) => {
    expect(interpretOneway({ oneway: value })).toBe('forward');
  });

  it.each([['-1'], ['reverse']])('oneway=%s goes against the node order', (value) => {
    expect(interpretOneway({ oneway: value })).toBe('reverse');
  });

  it.each([['no'], ['false'], ['0']])('oneway=%s is a two-way street', (value) => {
    expect(interpretOneway({ oneway: value })).toBe('none');
  });

  it('treats a street without the tag as two-way', () => {
    expect(interpretOneway({})).toBe('none');
  });

  it('treats reversible streets as two-way', () => {
    expect(interpretOneway({ oneway: 'reversible' })).toBe('none');
  });

  it('treats roundabouts as one-way', () => {
    expect(interpretOneway({ junction: 'roundabout' })).toBe('forward');
    expect(interpretOneway({ junction: 'circular' })).toBe('forward');
  });

  it('lets an explicit oneway tag win over the roundabout rule', () => {
    expect(interpretOneway({ junction: 'roundabout', oneway: 'no' })).toBe('none');
  });
});
