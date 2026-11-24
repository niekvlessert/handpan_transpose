const pitchNames = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function noteName(pitch) {
  return pitchNames[pitch % 12] + (Math.floor(pitch / 12) - 1);
}

export function parseNotes(input) {
  const tokens = input.trim().split(/[\s,;/]+/).filter(Boolean);
  return tokens.map(token => {
    const match = /^([a-g])([#b♯♭]?)(-?\d+)$/i.exec(token);
    if (!match) throw new Error(`Ongeldige noot: ${token}. Gebruik bijvoorbeeld D4 of F#4.`);
    const [, letter, accidental, octave] = match;
    const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const adjustment = accidental ? ('#♯'.includes(accidental) ? 1 : -1) : 0;
    const pitch = (Number(octave) + 1) * 12 + naturals[letter.toUpperCase()] + adjustment;
    if (pitch < 0 || pitch > 127) throw new Error(`Noot buiten het MIDI-bereik: ${token}.`);
    return pitch;
  });
}

export function parseMelody(input, bpm) {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) throw new Error('Gebruik een tempo tussen 20 en 300 BPM.');
  let time = 0;
  const notes = [];
  for (const token of input.trim().split(/[\s,;|]+/).filter(Boolean)) {
    const [chord, length = '1', ...extra] = token.split(':');
    const beats = Number(length);
    if (extra.length || beats <= 0 || !Number.isFinite(beats)) {
      throw new Error(`Ongeldige duur in ${token}. Gebruik bijvoorbeeld D4:0.5 of -:2.`);
    }
    const duration = beats * 60 / bpm;
    if (!Number.isFinite(time + duration)) throw new Error('De melodie is te lang.');
    if (chord !== '-') {
      const pitches = chord.split('+').map(part => {
        const parsed = parseNotes(part);
        if (parsed.length !== 1) throw new Error(`Ongeldig akkoord: ${chord}.`);
        return parsed[0];
      });
      for (const pitch of new Set(pitches)) notes.push({ pitch, time, duration, velocity: 0.8 });
    }
    time += duration;
  }
  if (!notes.length) throw new Error('Voer minstens één noot in.');
  return { notes, duration: time };
}

export function findTranspositions(notes, instrument) {
  if (!notes.length) return [{ shift: 0, missing: [], missingCount: 0 }];
  const counts = new Map();
  for (const { pitch } of notes) counts.set(pitch, (counts.get(pitch) ?? 0) + 1);
  const pitches = [...counts.keys()].sort((a, b) => a - b);
  const available = new Set(instrument);
  const lowestShift = -pitches[0];
  const highestShift = 127 - pitches.at(-1);
  const options = [];
  for (let shift = lowestShift; shift <= highestShift; shift += 1) {
    const missing = [];
    let missingCount = 0;
    for (const source of pitches) {
      const pitch = source + shift;
      if (available.has(pitch)) continue;
      const count = counts.get(source);
      missing.push({ pitch, count });
      missingCount += count;
    }
    options.push({ shift, missing, missingCount });
  }
  return options.sort((a, b) => a.missingCount - b.missingCount || a.missing.length - b.missing.length ||
    Math.abs(a.shift) - Math.abs(b.shift) || b.shift - a.shift);
}

export function notesInFragment(notes, start, end) {
  const selected = [];
  for (const note of notes) {
    if (note.time >= end) break;
    const from = Math.max(start, note.time);
    const to = Math.min(end, note.time + note.duration);
    if (to > from) selected.push({ ...note, time: from, duration: to - from });
  }
  return selected;
}

export function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new Error('Dit bestand is geen Standard MIDI File.');
  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (headerLength < 6 || headerLength + 8 > bytes.length || !trackCount) throw new Error('Ongeldige MIDI-header.');
  if (format > 1) throw new Error('Exporteer als Standard MIDI File type 0 of 1.');
  if (!division || division & 0x8000) throw new Error('Exporteer MIDI met een muzikale tijdbasis (PPQ).');

  const tempos = [{ tick: 0, micros: 500000 }];
  const tracks = [];
  let offset = headerLength + 8;
  let trackIndex = 0;
  while (trackIndex < trackCount) {
    if (offset + 8 > bytes.length) throw new Error('Het MIDI-bestand is afgebroken.');
    const end = offset + 8 + view.getUint32(offset + 4);
    if (end > bytes.length) throw new Error('Een MIDI-spoor is afgebroken.');
    const type = tag(offset);
    let cursor = offset + 8;
    offset = end;
    if (type !== 'MTrk') continue;
    trackIndex += 1;

    const read = () => {
      if (cursor >= end) throw new Error('Een MIDI-event is afgebroken.');
      return bytes[cursor++];
    };
    const readData = () => {
      const value = read();
      if (value > 127) throw new Error('Ongeldige MIDI-eventdata.');
      return value;
    };
    const readVariable = () => {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        const byte = read();
        value = value * 128 + (byte & 127);
        if (byte < 128) return value;
      }
      throw new Error('Ongeldige lengte in MIDI-event.');
    };

    let tick = 0;
    let runningStatus = 0;
    let name = '';
    const channels = new Map();
    const active = new Map();
    const finish = (queue, endTick) => {
      const note = queue.shift();
      if (note) channels.get(note.channel).push({ ...note, endTick });
    };
    while (cursor < end) {
      tick += readVariable();
      let status = read();
      if (status < 128) {
        if (!runningStatus) throw new Error('Ongeldige MIDI-status.');
        cursor -= 1;
        status = runningStatus;
      }
      if (status >= 0xf0) {
        runningStatus = 0;
        if (![0xff, 0xf0, 0xf7].includes(status)) throw new Error('Onbekend MIDI-event.');
        const meta = status === 0xff ? read() : -1;
        const length = readVariable();
        const next = cursor + length;
        if (next > end) throw new Error('Een MIDI-event is afgebroken.');
        if (meta === 0x03) name = decoder.decode(bytes.subarray(cursor, next)).replaceAll('\0', '').trim();
        if (meta === 0x51 && length === 3) {
          const micros = bytes[cursor] * 65536 + bytes[cursor + 1] * 256 + bytes[cursor + 2];
          if (micros) tempos.push({ tick, micros });
        }
        cursor = next;
        if (meta === 0x2f) break;
        continue;
      }
      runningStatus = status;
      const kind = status >> 4;
      const channel = status & 15;
      const pitch = readData();
      const value = kind === 0x0c || kind === 0x0d ? 0 : readData();
      if (channel === 9 || (kind !== 8 && kind !== 9)) continue;
      const key = channel * 128 + pitch;
      if (kind === 9 && value) {
        if (!channels.has(channel)) channels.set(channel, []);
        if (!active.has(key)) active.set(key, []);
        active.get(key).push({ tick, pitch, channel, velocity: value / 127 });
      } else if (active.has(key)) {
        const queue = active.get(key);
        finish(queue, tick);
        if (!queue.length) active.delete(key);
      }
    }
    for (const queue of active.values()) {
      while (queue.length) finish(queue, tick);
    }
    for (const [channel, notes] of channels) {
      const title = name || `Spoor ${trackIndex}`;
      tracks.push({ name: `${title} · kanaal ${channel + 1}`, notes });
    }
  }
  if (!tracks.length) throw new Error('Geen melodische noten gevonden in dit MIDI-bestand.');

  tempos.sort((a, b) => a.tick - b.tick);
  let seconds = 0;
  for (const [index, tempo] of tempos.entries()) {
    const previous = tempos[index - 1];
    if (previous) seconds += (tempo.tick - previous.tick) * previous.micros / division / 1e6;
    tempo.seconds = seconds;
  }
  function timeAt(tick) {
    let left = 0;
    let right = tempos.length;
    while (right - left > 1) {
      const middle = (left + right) >> 1;
      if (tempos[middle].tick <= tick) left = middle;
      else right = middle;
    }
    const tempo = tempos[left];
    return tempo.seconds + (tick - tempo.tick) * tempo.micros / division / 1e6;
  }
  return tracks.map(track => {
    const notes = track.notes.sort((a, b) => a.tick - b.tick).map(note => ({
      pitch: note.pitch,
      time: timeAt(note.tick),
      duration: Math.max(0.03, timeAt(note.endTick) - timeAt(note.tick)),
      velocity: note.velocity,
    }));
    const duration = notes.reduce((end, note) => Math.max(end, note.time + note.duration), 0);
    return { name: track.name, notes, duration };
  });
}
