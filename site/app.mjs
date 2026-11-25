import { findTranspositions, noteName, notesInFragment, parseMelody, parseMidi, parseNotes } from './music.mjs';

const $ = id => document.getElementById(id);
const dKurd = {
  name: 'D Kurd 10',
  scale: 'D mineur',
  notes: parseNotes('D3 A3 Bb3 C4 D4 E4 F4 G4 A4 C5'),
  // Angles from the player's side, in note order after the central ding.
  topAngles: [20, -20, 60, -60, 100, -100, 140, -140, 180],
  bottom: [],
};
const kurdBottomNotes = parseNotes('F3 G3');
const instruments = [
  dKurd,
  {
    name: 'E Amara 13',
    scale: 'E Celtic mineur',
    layoutHint: 'Bovenkant volgens Panersia E Amara 20.',
    // Player's view, as percentages of the top shell, from Panersia's labeled photo.
    fields: [
      { note: 'E3', x: 50, y: 58, size: 24 },
      { note: 'B3', x: 50, y: 86, size: 19 },
      { note: 'D4', x: 22, y: 75, size: 18 },
      { note: 'E4', x: 78, y: 76, size: 18 },
      { note: 'F#4', x: 13, y: 49, size: 17 },
      { note: 'G4', x: 87, y: 51, size: 17 },
      { note: 'A4', x: 18, y: 29, size: 15 },
      { note: 'B4', x: 84, y: 27, size: 15 },
      { note: 'D5', x: 36, y: 13, size: 15 },
      { note: 'E5', x: 65, y: 14, size: 15 },
      { note: 'F#5', x: 35, y: 35, size: 13 },
      { note: 'G5', x: 67, y: 36, size: 13 },
      { note: 'A5', x: 50, y: 23, size: 12 },
    ],
  },
  { name: 'E Asha 10', scale: 'E majeur', notes: parseNotes('E3 A3 B3 C#4 D#4 E4 F#4 G#4 A4 B4') },
  { name: 'Eigen handpan', scale: 'Eigen stemming', notes: [] },
];
for (const pan of instruments) {
  if (pan.fields) pan.notes = parseNotes(pan.fields.map(field => field.note).join(' '));
}
const custom = instruments.at(-1);
custom.notes = parseNotes($('custom-notes').value);
const demo = 'D4:0.5 F4:0.5 A4 G4:0.5 F4:0.5 E4 -:0.5 C4:0.5 E4 G4:0.5 F4:0.5 D4:2 -:0.5 A3:0.5 C4:0.5 D4 F4:0.5 G4:0.5 A4 -:0.5 G4:0.5 F4 E4:0.5 C4:0.5 D4+A3:2';
let song = parseMelody(demo, 96);
let practice = { start: 0, end: song.duration, notes: song.notes };
let songName = 'Oefenmelodie';
let tracks = [];
let preview = null;
let instrument = instruments[0];
let match = { shift: 0, missing: [], missingCount: 0 };
const matchesByInstrument = new Map();
const panControls = new Map();
let position = 0;
let playing = false;
let rate = 1;
let originTime = 0;
let originPosition = 0;
let frame = 0;
let nextAudio = 0;
let nextVisual = 0;
let activeVisual = [];
let audio;
let master;
let missingOutput;
const voices = new Set();
const pads = new Map();
const tapped = new Map();
let playRequest = 0;
let importRequest = 0;

function showMessage(element, message = '') {
  element.hidden = !message;
  element.textContent = message;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function stamp(seconds) {
  const whole = Math.floor(seconds + 0.000001);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function preciseStamp(seconds) {
  const tenths = Math.floor(seconds * 10 + 0.000001);
  return `${stamp(Math.floor(tenths / 10))},${tenths % 10}`;
}

function makeOption(label, value) {
  return new Option(label, value);
}

function getTime() {
  if (!playing) return position;
  return Math.min(practice.end, originPosition + Math.max(0, audio.currentTime - originTime) * rate);
}

function showProgress(time) {
  $('progress').value = time;
  $('progress').style.setProperty('--progress', `${time / song.duration * 100}%`);
  const current = stamp(time);
  $('progress').setAttribute('aria-valuetext', current);
  $('clock').value = `${current} / ${stamp(song.duration)}`;
}

function updatePlayButton() {
  $('play').classList.toggle('playing', playing);
  $('play').setAttribute('aria-label', playing ? 'Pauzeren' : 'Afspelen');
  $('play').title = playing ? 'Pauzeren (spatie)' : 'Afspelen (spatie)';
}

function showPitches(pitches) {
  for (const [pitch, pad] of pads) pad.classList.toggle('lit', pitches.has(pitch));
  const available = [];
  const missing = [];
  for (const pitch of [...pitches].sort((a, b) => a - b)) {
    (pads.has(pitch) ? available : missing).push(noteName(pitch));
  }
  $('live-note').textContent = available.join(' · ');
  const missingLabel = $('mute-missing').checked ? 'Gedempt' : 'Zonder toonveld';
  $('live-missing').textContent = missing.length ? `${missingLabel}: ${missing.join(' · ')}` : '';
}

function resetVisuals(time) {
  activeVisual = [];
  nextVisual = 0;
  renderVisuals(time);
}

function renderVisuals(time) {
  const pitches = new Set(tapped.keys());
  if (time < practice.end) {
    while (nextVisual < practice.notes.length && practice.notes[nextVisual].time <= time + 0.001) {
      activeVisual.push(practice.notes[nextVisual++]);
    }
    activeVisual = activeVisual.filter(note => note.time + Math.max(0.11 * rate, note.duration) > time);
    for (const note of activeVisual) pitches.add(note.pitch + match.shift);
  }
  showPitches(pitches);
}

function renderTimeline() {
  const bars = document.createDocumentFragment();
  const count = song.notes.length;
  const stride = Math.ceil(count / 420);
  const min = song.notes.reduce((range, note) => Math.min(range, note.pitch), 127);
  const max = song.notes.reduce((range, note) => Math.max(range, note.pitch), 0);
  for (let index = 0; index < count; index += stride) {
    const note = song.notes[index];
    const bar = document.createElement('i');
    bar.style.left = `${note.time / song.duration * 100}%`;
    bar.style.width = `${note.duration / song.duration * 100}%`;
    bar.style.bottom = `${17 + (note.pitch - min) / Math.max(1, max - min) * 61}%`;
    bars.append(bar);
  }
  $('timeline-notes').replaceChildren(bars);
}

function transposeLabel(shift) {
  if (shift === 0) return 'Originele toonhoogte';
  return `${signed(shift)} ${Math.abs(shift) === 1 ? 'halve toon' : 'halve tonen'}`;
}

function missingLabel(count) {
  return count === 1 ? '1 aanslag ontbreekt' : `${count} aanslagen ontbreken`;
}

function renderPanChoices() {
  const rows = instruments.map(pan => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (pan !== instrument) chooseInstrument(pan);
    });
    const name = document.createElement('strong');
    name.textContent = pan.name;
    const summary = document.createElement('span');
    button.append(name, summary);
    row.append(button);
    if (pan === dKurd) {
      const label = document.createElement('label');
      label.className = 'kurd-bottom-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => {
        dKurd.bottom = input.checked ? kurdBottomNotes : [];
        renderPanMatches();
        chooseInstrument(dKurd);
      });
      label.append(input, ' +2 aan de onderkant (F3 en G3)');
      row.append(label);
    }
    panControls.set(pan, { button, summary });
    return row;
  });
  $('pan-matches').replaceChildren(...rows);
}

function renderPanMatches() {
  for (const pan of instruments) {
    const options = findTranspositions(practice.notes, [...pan.notes, ...(pan.bottom ?? [])]);
    const complete = options.filter(option => !option.missingCount);
    const best = options[0];
    matchesByInstrument.set(pan, options);
    const { summary } = panControls.get(pan);
    summary.hidden = !practice.notes.length;
    summary.classList.toggle('match-complete', !!complete.length);
    if (complete.length) {
      const shifts = complete.map(option => signed(option.shift)).join(', ');
      summary.textContent = complete.length === 1
        ? `Past · ${transposeLabel(best.shift)}`
        : `Past · ${shifts} halve tonen`;
    } else {
      summary.textContent = `${missingLabel(best.missingCount)} · ${transposeLabel(best.shift)}`;
    }
  }
}

function updateMatch() {
  const options = matchesByInstrument.get(instrument);
  $('transpose').replaceChildren(...options.map(({ shift, missingCount }, index) => {
    const label = transposeLabel(shift);
    if (!practice.notes.length) return makeOption(label, shift);
    const fit = missingCount ? missingLabel(missingCount) : 'Past';
    return makeOption(`${label} · ${index === 0 ? 'Beste · ' : ''}${fit}`, shift);
  }));
  $('transpose').disabled = options.length < 2;
  for (const [pan, { button }] of panControls) button.setAttribute('aria-pressed', String(pan === instrument));
  match = options[0];
  showMatch();
}

function showMatch() {
  const fit = $('fit');
  const empty = !practice.notes.length;
  $('play').disabled = empty;
  fit.classList.toggle('unfit', empty || !!match.missingCount);
  if (empty) {
    fit.textContent = 'Dit fragment bevat geen noten.';
  } else if (match.missingCount) {
    const breakdown = match.missing.map(({ pitch, count }) => `${noteName(pitch)} × ${count}`);
    const label = $('mute-missing').checked ? 'Gedempt zonder toonveld' : 'Hoorbaar zonder toonveld';
    fit.textContent = `${label}: ${breakdown.join(', ')}.`;
  } else {
    fit.textContent = 'Alle melodienoten passen.';
  }
  resetVisuals(getTime());
}

function layoutPad(index, count, topAngles) {
  if (!index) return { x: 50, y: 50, angle: 0, size: 23 };
  const outerCount = Math.min(count - 1, 12);
  const inner = index > outerCount;
  const slots = inner ? count - 1 - outerCount : outerCount;
  const step = index - (inner ? outerCount + 1 : 1);
  const distance = slots % 2 ? Math.ceil(step / 2) : Math.floor(step / 2) + 0.5;
  const direction = slots % 2 ? (step % 2 ? 1 : -1) : (step % 2 ? -1 : 1);
  const angle = topAngles?.[index - 1] ?? (direction * distance * 360 / slots + (inner ? 180 / Math.max(slots, 2) : 0));
  const radians = angle * Math.PI / 180;
  const radius = inner ? 22 : 35.5;
  return {
    x: 50 + Math.sin(radians) * radius,
    y: 50 + Math.cos(radians) * radius,
    angle: -angle,
    size: inner ? 12 : Math.min(19, 195 / slots),
  };
}

function makePad(pitch, { x, y, angle = 0, size }, ding = false) {
  const pad = document.createElement('button');
  pad.type = 'button';
  pad.className = ding ? 'pad ding' : 'pad';
  pad.style.cssText = `--x:${x}%;--y:${y}%;--angle:${angle}deg;--size:${size}%;`;
  const label = document.createElement('span');
  label.textContent = noteName(pitch);
  pad.append(label);
  pad.setAttribute('aria-label', ding ? `${noteName(pitch)}, ding` : noteName(pitch));
  pad.addEventListener('click', () => { void tap(pitch); });
  pads.set(pitch, pad);
  return pad;
}

function renderInstrument() {
  const bottom = instrument.bottom ?? [];
  $('pan-title').textContent = bottom.length ? `${instrument.name} +${bottom.length}` : instrument.name;
  $('pan-caption').textContent = `${instrument.scale} · ${instrument.notes.length + bottom.length} noten`;
  $('top-caption').hidden = !bottom.length;
  $('bottom-face').hidden = !bottom.length;
  const layoutHint = instrument.layoutHint ?? (instrument.topAngles ? '' : 'Schematische indeling.');
  $('layout-hint').hidden = !layoutHint;
  $('layout-hint').textContent = layoutHint ? `${layoutHint} ` : '';
  for (const timer of tapped.values()) clearTimeout(timer);
  tapped.clear();
  pads.clear();
  const topPads = instrument.notes.map((pitch, index) =>
    makePad(pitch, instrument.fields?.[index] ?? layoutPad(index, instrument.notes.length, instrument.topAngles), index === 0));
  const bottomPads = bottom.map((pitch, index) => makePad(pitch, { x: index ? 76 : 24, y: 64, angle: 0, size: 30 }));
  $('instrument').replaceChildren(...topPads);
  $('instrument-bottom').replaceChildren(...bottomPads);
  const labels = [...pads.keys()].map(pitch => {
    const chip = document.createElement('li');
    chip.textContent = noteName(pitch);
    return chip;
  });
  $('pitch-list').replaceChildren(...labels);
}

async function getAudio() {
  if (!audio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Deze browser ondersteunt geen Web Audio.');
    audio = new AudioContext();
    master = audio.createDynamicsCompressor();
    master.connect(audio.destination);
    missingOutput = audio.createGain();
    missingOutput.gain.value = $('mute-missing').checked ? 0 : 1;
    missingOutput.connect(master);
  }
  if (audio.state !== 'running') await audio.resume();
  return audio;
}

function strike(pitch, time, velocity, destination = master, transport = true) {
  const output = audio.createGain();
  output.connect(destination);
  const voice = { output, transport };
  voices.add(voice);
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  const partials = [
    [1, 0.29, 1.38],
    [2.001, 0.115, 0.84],
    [2.997, 0.062, 0.55],
    [4.012, 0.022, 0.22],
    [6.19, 0.035, 0.065],
  ];
  for (const [index, [ratio, level, decay]] of partials.entries()) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level * (0.23 + 0.77 * velocity), time + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    oscillator.connect(envelope).connect(output);
    oscillator.start(time);
    oscillator.stop(time + decay + 0.02);
    if (!index) oscillator.onended = () => {
      output.disconnect();
      voices.delete(voice);
    };
  }
}

function silenceTransport() {
  if (!audio) return;
  for (const voice of voices) {
    if (!voice.transport) continue;
    voice.output.gain.setTargetAtTime(0, audio.currentTime, 0.006);
  }
}

function scheduleNotes(notes, index, startTime, startPosition, speed, shift, playablePitches) {
  const now = audio.currentTime;
  const lookAhead = now + 0.09;
  while (index < notes.length) {
    const note = notes[index];
    const when = startTime + (note.time - startPosition) / speed;
    if (when > lookAhead) break;
    if (when >= now - 0.08) {
      const pitch = note.pitch + shift;
      const destination = playablePitches && !playablePitches.has(pitch) ? missingOutput : master;
      strike(pitch, Math.max(when, now), note.velocity, destination);
    }
    index += 1;
  }
  return index;
}

function tick() {
  if (!playing) return;
  const time = getTime();
  nextAudio = scheduleNotes(practice.notes, nextAudio, originTime, originPosition, rate, match.shift, pads);
  showProgress(time);
  renderVisuals(time);
  if (time >= practice.end) {
    position = practice.end;
    playing = false;
    if (practice.end < song.duration) silenceTransport();
    updatePlayButton();
    return;
  }
  frame = requestAnimationFrame(tick);
}

function anchor(time) {
  originPosition = time;
  originTime = audio.currentTime + 0.025;
  nextAudio = practice.notes.findIndex(note => note.time >= time - 0.000001);
  if (nextAudio === -1) nextAudio = practice.notes.length;
}

function seek(time) {
  position = Math.max(practice.start, Math.min(practice.end, time));
  showProgress(position);
  resetVisuals(position);
  if (playing) {
    silenceTransport();
    anchor(position);
  }
}

function pause() {
  playRequest += 1;
  position = getTime();
  playing = false;
  cancelAnimationFrame(frame);
  clearPreview();
  silenceTransport();
  updatePlayButton();
  showProgress(position);
  resetVisuals(position);
}

async function togglePlay() {
  if (playing) {
    pause();
    return;
  }
  if (!practice.notes.length) return;
  if (preview) pause();
  const request = ++playRequest;
  try {
    await getAudio();
    if (request !== playRequest) return;
    showMessage($('import-error'));
    if (position >= practice.end) seek(practice.start);
    anchor(position);
    playing = true;
    updatePlayButton();
    tick();
  } catch (error) {
    showMessage($('import-error'), error.message);
  }
}

function setPreviewButton(button, track, listening) {
  button.textContent = listening ? 'Stop' : 'Luister';
  button.setAttribute('aria-label', `${listening ? 'Stop' : 'Luister naar'} ${track.name}`);
}

function clearPreview() {
  if (!preview) return;
  cancelAnimationFrame(preview.frame);
  setPreviewButton(preview.button, preview.track, false);
  preview = null;
}

async function audition(track, button) {
  const wasListening = preview?.track === track;
  pause();
  if (wasListening) return;

  const current = { track, button, frame: 0 };
  preview = current;
  setPreviewButton(button, track, true);
  try {
    await getAudio();
    if (preview !== current) return;
    showMessage($('import-error'));
    const firstNote = track.notes[0].time;
    const start = audio.currentTime + 0.025;
    const end = start + track.duration - firstNote;
    let next = 0;
    const playPreview = () => {
      next = scheduleNotes(track.notes, next, start, firstNote, 1, 0);
      if (audio.currentTime >= end) clearPreview();
      else current.frame = requestAnimationFrame(playPreview);
    };
    playPreview();
  } catch (error) {
    if (preview !== current) return;
    clearPreview();
    showMessage($('import-error'), error.message);
  }
}

async function tap(pitch) {
  try {
    await getAudio();
    strike(pitch, audio.currentTime, 0.8, master, false);
    clearTimeout(tapped.get(pitch));
    tapped.set(pitch, setTimeout(() => {
      tapped.delete(pitch);
      if (!playing) renderVisuals(position);
    }, 260));
    if (!playing) renderVisuals(position);
  } catch (error) {
    showMessage($('import-error'), error.message);
  }
}

function chooseInstrument(next) {
  pause();
  instrument = next;
  $('custom-form').hidden = instrument !== custom;
  renderInstrument();
  updateMatch();
}

function setFragment(startTick, endTick) {
  pause();
  const max = Number($('fragment-end').max);
  const start = startTick / 10;
  const end = endTick === max ? song.duration : endTick / 10;
  const wholeTrack = start === 0 && end === song.duration;
  practice = { start, end, notes: wholeTrack ? song.notes : notesInFragment(song.notes, start, end) };
  $('fragment-start').value = startTick;
  $('fragment-end').value = endTick;
  for (const [key, time] of [['start', start], ['end', end]]) {
    const label = preciseStamp(time);
    $(`fragment-${key}-time`).value = label;
    $(`fragment-${key}`).setAttribute('aria-valuetext', label);
  }
  $('fragment-reset').disabled = wholeTrack;
  const restartLabel = wholeTrack ? 'Naar het begin' : 'Naar het begin van het fragment';
  $('restart').title = restartLabel;
  $('restart').setAttribute('aria-label', restartLabel);
  $('timeline-notes').style.setProperty('--fragment-start', `${start / song.duration * 100}%`);
  $('timeline-notes').style.setProperty('--fragment-end', `${end / song.duration * 100}%`);
  position = start;
  showProgress(start);
  renderPanMatches();
  updateMatch();
}

function loadSong(selectedSong, name) {
  song = selectedSong;
  songName = name;
  $('song-name').textContent = songName;
  $('song-info').textContent = `${song.notes.length} noten · ${stamp(song.duration)}`;
  $('progress').max = song.duration;
  renderTimeline();
  const max = Math.ceil(song.duration * 10);
  $('fragment-start').max = max;
  $('fragment-end').max = max;
  setFragment(0, max);
}

function renderTracks() {
  const rows = tracks.map((track, index) => {
    const row = document.createElement('li');
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'midi-track';
    radio.checked = index === 0;
    radio.addEventListener('change', () => loadSong(track, songName));

    const name = document.createElement('span');
    name.textContent = track.name;
    label.append(radio, name);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    setPreviewButton(button, track, false);
    button.addEventListener('click', () => { void audition(track, button); });
    row.append(label, button);
    return row;
  });
  $('track-list').replaceChildren(...rows);
  $('track-field').hidden = !rows.length;
}

renderPanChoices();
renderInstrument();
loadSong(song, songName);

$('custom-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const notes = [...new Set(parseNotes($('custom-notes').value))];
    if (notes.length < 2 || notes.length > 21) throw new Error('Geef 2 tot 21 verschillende noten op.');
    custom.notes = notes;
    showMessage($('custom-error'));
    renderPanMatches();
    chooseInstrument(custom);
  } catch (error) {
    showMessage($('custom-error'), error.message);
  }
});

$('transpose').addEventListener('change', () => {
  pause();
  match = matchesByInstrument.get(instrument).find(option => option.shift === Number($('transpose').value));
  showMatch();
});
$('mute-missing').addEventListener('change', event => {
  if (missingOutput) missingOutput.gain.setTargetAtTime(event.target.checked ? 0 : 1, audio.currentTime, 0.008);
  showMatch();
});
$('play').addEventListener('click', () => { void togglePlay(); });
$('restart').addEventListener('click', () => seek(practice.start));
$('back').addEventListener('click', () => seek(getTime() - 5));
$('forward').addEventListener('click', () => seek(getTime() + 5));
$('progress').addEventListener('input', () => seek(Number($('progress').value)));
$('fragment-start').addEventListener('input', event => {
  const end = Number($('fragment-end').value);
  setFragment(Math.min(Number(event.target.value), end - 1), end);
});
$('fragment-end').addEventListener('input', event => {
  const start = Number($('fragment-start').value);
  setFragment(start, Math.max(Number(event.target.value), start + 1));
});
$('fragment-reset').addEventListener('click', () => setFragment(0, Number($('fragment-end').max)));
$('speed').addEventListener('change', () => {
  const time = getTime();
  rate = Number($('speed').value);
  seek(time);
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || $('notation').open ||
      event.target.closest('button, input, select, textarea, a, label')) return;
  event.preventDefault();
  void togglePlay();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (playing || preview)) pause();
});

$('midi-file').addEventListener('change', async () => {
  const file = $('midi-file').files[0];
  $('midi-file').value = '';
  if (!file) return;
  const request = ++importRequest;
  try {
    const nextTracks = parseMidi(await file.arrayBuffer());
    if (request !== importRequest) return;
    tracks = nextTracks;
    const name = file.name.replace(/\.midi?$/i, '');
    loadSong(tracks[0], name);
    renderTracks();
    showMessage($('import-error'));
  } catch (error) {
    if (request === importRequest) showMessage($('import-error'), error.message);
  }
});

$('manual').addEventListener('click', () => {
  showMessage($('notation-error'));
  $('notation').showModal();
});
$('cancel-notation').addEventListener('click', () => $('notation').close());
$('notation-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const melody = parseMelody($('notation-notes').value, Number($('bpm').value));
    importRequest += 1;
    tracks = [];
    loadSong(melody, 'Eigen melodie');
    renderTracks();
    showMessage($('import-error'));
    $('notation').close();
  } catch (error) {
    showMessage($('notation-error'), error.message);
  }
});
