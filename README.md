# Supernotes (Live Notes)

A Windows desktop app that records a lecture, transcribes it locally, and turns it into structured notes and flashcards. Everything runs on your machine: no cloud APIs and no audio leaves your PC.

## What it does

1. **Record** from the microphone, system audio (WASAPI loopback), or both mixed.
2. **Transcribe** with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CUDA if available, CPU otherwise). A glossary can bias recognition toward course terms.
3. **Summarize and extract** with a local [Ollama](https://ollama.com) model (map/reduce summary, flashcards, key terms).
4. **Export** `notes.md`, a transcript (`.vtt`), and an Anki deck (`.apkg`).
5. **Review** cards with built-in spaced repetition, filter by course, and run practice sessions.
6. **Search** across titles, transcripts, summaries and terms in the Library.

## Architecture

| Part | Stack | Path |
|------|-------|------|
| Desktop UI | Electron, React 19, Vite, Tailwind 4, TanStack Query | [desktop/](desktop/) |
| Engine | Python 3.12, FastAPI, faster-whisper, genanki, pyaudiowpatch | [engine/](engine/) |

The Electron app launches the engine as a local sidecar and talks to it over HTTP/WebSocket on localhost with a per-session token. Processing runs through a single-worker queue; each stage persists its status, so an interrupted lecture resumes on restart.

```
engine/
  app.py          FastAPI routes
  pipeline.py     queue: transcribe -> summarize -> extract -> assemble
  capture/        WASAPI recorder
  transcribe/     faster-whisper
  notes/          Ollama client, summarize, extract
  assemble/       notes.md + Anki deck
  prompts/        LLM prompts
  store.py        lecture storage; cards.py, search.py
desktop/
  electron/       main process
  src/            React UI (Record, Library, LectureDetail, Review, Profile)
```

## Requirements

- Windows 10/11
- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js and npm
- [Ollama](https://ollama.com) running on `127.0.0.1:11434`, with a model pulled (default: `llama3.1:8b`, run `ollama pull llama3.1:8b`)
- Optional: NVIDIA GPU for faster transcription (CUDA 12 libraries are installed via the Python dependencies)

## Getting started

```powershell
git clone https://github.com/Sahil2802/SuperNotes.git
cd SuperNotes
ollama pull llama3.1:8b
cd engine; uv sync; cd ../desktop; npm install; npm run dev
```

The first run downloads the Whisper model (default: `small`). Models and other settings are stored in the engine config, and the app's health check reports whether Ollama and Whisper are ready.

## Privacy

Audio, transcripts and notes stay on your machine. The only network traffic is the one-time Whisper model download and calls to your local Ollama server. Only record lectures you have permission to record.

## Development

Engine:

```powershell
cd engine
uv sync
uv run pytest
```

Desktop (dev mode with hot reload):

```powershell
cd desktop
npm install
npm run dev
```

## Build an installer

Package the engine with PyInstaller, then build the Electron installer, which bundles `engine/dist/engine`:

```powershell
cd engine
uv run pyinstaller pyinstaller.spec
cd ../desktop
npm run dist
```

The NSIS installer is written to `desktop/release/`.

## Contributing

Issues and pull requests are welcome. Please run `uv run pytest` in `engine/` and `npm run build` in `desktop/` before opening a PR. Windows is the only supported platform right now (audio capture uses WASAPI), so ports to other OSes would be a welcome contribution.

## License

No license has been chosen yet. Add a `LICENSE` file (MIT is a common default) before publishing, and update this section.
