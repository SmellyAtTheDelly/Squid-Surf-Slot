'use strict';

const Z95 = 1.959963984540054;

class Moments {
  constructor() {
    this.count = 0;
    this.sum = 0;
    this.mean = 0;
    this.m2 = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  add(value) {
    if (!Number.isFinite(value)) throw new TypeError('Sample must be finite');
    this.count++;
    this.sum += value;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (value - this.mean);
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    return this;
  }

  summary() {
    const variance = this.count > 1 ? Math.max(0, this.m2 / (this.count - 1)) : null;
    const standardDeviation = variance == null ? null : Math.sqrt(variance);
    const standardError = standardDeviation == null ? null : standardDeviation / Math.sqrt(this.count);
    return {
      count: this.count,
      sum: this.sum,
      mean: this.count ? this.mean : null,
      variance,
      standardDeviation,
      standardError,
      confidence95: standardError == null ? null : [this.mean - Z95 * standardError, this.mean + Z95 * standardError],
      min: this.count ? this.min : null,
      max: this.count ? this.max : null,
    };
  }
}

module.exports = { Moments, Z95 };
