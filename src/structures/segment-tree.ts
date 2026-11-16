/**
 * An operation that joins two values into one, and the value that changes nothing when it is
 * joined (the "identity"). `combine` must be associative: combine(combine(a, b), c) is the same as
 * combine(a, combine(b, c)). It does NOT have to be commutative: the order of the values is kept,
 * so it can join pieces of a street from its first segment to its last.
 */
export interface Monoid<T> {
  readonly identity: T;
  combine(left: T, right: T): T;
}

/**
 * Segment tree: answers "what do positions from..to add up to?" in O(log n), and changes the
 * value of one position in O(log n). It is built in O(n).
 *
 * The values are kept in an array of 2n cells. The leaves are the last n cells, and the cell i
 * holds the join of cells 2i and 2i+1, so cell 1 is the join of everything. A range is answered
 * by walking up from both ends and taking the cells that fall entirely inside it.
 *
 * Ranges are half-open, like Array.slice: query(2, 5) joins the positions 2, 3 and 4.
 */
export class SegmentTree<T> {
  private readonly cells: T[];
  readonly size: number;

  constructor(
    values: readonly T[],
    private readonly monoid: Monoid<T>,
  ) {
    this.size = values.length;
    this.cells = new Array<T>(2 * this.size).fill(monoid.identity);
    values.forEach((value, index) => {
      this.cells[this.size + index] = value;
    });
    for (let cell = this.size - 1; cell >= 1; cell--) {
      this.cells[cell] = this.join(cell);
    }
  }

  /** The value of one position. */
  get(index: number): T {
    this.checkIndex(index);
    return this.cells[this.size + index] as T;
  }

  /** Changes the value of one position and the cells above it. */
  update(index: number, value: T): void {
    this.checkIndex(index);
    let cell = this.size + index;
    this.cells[cell] = value;
    for (cell >>= 1; cell >= 1; cell >>= 1) {
      this.cells[cell] = this.join(cell);
    }
  }

  /** The join of the positions from `from` (included) to `to` (not included), in order. */
  query(from: number, to: number): T {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > this.size) {
      throw new RangeError(`The range ${from}..${to} is not inside 0..${this.size}`);
    }
    let left = this.monoid.identity;
    let right = this.monoid.identity;
    let low = from + this.size;
    let high = to + this.size;
    while (low < high) {
      if (low & 1) {
        left = this.monoid.combine(left, this.cells[low++] as T);
      }
      if (high & 1) {
        right = this.monoid.combine(this.cells[--high] as T, right);
      }
      low >>= 1;
      high >>= 1;
    }
    return this.monoid.combine(left, right);
  }

  /** The join of every position. */
  total(): T {
    return this.query(0, this.size);
  }

  private join(cell: number): T {
    return this.monoid.combine(this.cells[2 * cell] as T, this.cells[2 * cell + 1] as T);
  }

  private checkIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`The position ${index} is not inside 0..${this.size - 1}`);
    }
  }
}
