// Real-time audio features from the playing <audio> element.

export class AudioFeatures {
  constructor(mediaElement) {
    this.el = mediaElement;
    this.ctx = null;
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.level = 0;
    this.beat = 0; // 1 on a detected beat, decays toward 0
    this.beatCount = 0;
    this._bassAvg = 0;
    this._lastBeat = -1;
  }

  // Browsers only allow an AudioContext after a user gesture, so call this from a click or play.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaElementSource(this.el);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
  }

  update(dt) {
    this.beat *= Math.exp(-dt * 7);
    if (!this.analyser || this.el.paused) {
      const k = Math.exp(-dt * 4);
      this.bass *= k;
      this.mid *= k;
      this.high *= k;
      this.level *= k;
      return;
    }

    this.analyser.getByteFrequencyData(this.bins);
    this.bass = this._band(20, 160);
    this.mid = this._band(160, 2000);
    this.high = this._band(2000, 10000);
    this.level = 0.5 * this.bass + 0.35 * this.mid + 0.15 * this.high;

    // A beat is a bass jump well above its recent average.
    const now = this.el.currentTime;
    const sinceLast = now - this._lastBeat;
    if (this.bass > this._bassAvg * 1.3 && this.bass > 0.2 && (sinceLast > 0.28 || sinceLast < 0)) {
      this.beat = 1;
      this.beatCount++;
      this._lastBeat = now;
    }
    this._bassAvg += (this.bass - this._bassAvg) * Math.min(1, dt * 3);
  }

  _band(lowHz, highHz) {
    const from = Math.max(1, Math.floor(lowHz / this.hzPerBin));
    const to = Math.min(this.bins.length - 1, Math.ceil(highHz / this.hzPerBin));
    let sum = 0;
    for (let i = from; i <= to; i++) sum += this.bins[i];
    return sum / ((to - from + 1) * 255);
  }
}
