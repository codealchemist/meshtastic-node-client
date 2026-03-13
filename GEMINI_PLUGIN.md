# Gemini Plugin

Connects the Meshtastic channel to the Google Gemini API. When a message
arrives starting with the trigger text (default `G, `), the remainder is sent
to Gemini and the reply is broadcast back to the channel.

## Example

```
[you]     G, What is LoRa?
[client]  LoRa (Long Range) is a wireless modulation technique…
```

## Setup

### 1. Get a Gemini API key

Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create a
free API key. No billing is required for the free tier.

### 2. Add the key to `.env`

```env
GEMINI_API_KEY=your_api_key_here
```

The plugin loads automatically on the next `npm run chat` start.

## Environment variables

| Variable              | Required | Default            | Description                                                  |
|-----------------------|----------|--------------------|--------------------------------------------------------------|
| `GEMINI_API_KEY`      | yes      | —                  | Google AI Studio API key                                     |
| `GEMINI_TRIGGER_TEXT` | no       | `G, `              | Prefix that activates the plugin                             |
| `GEMINI_MODEL`        | no       | `gemini-2.0-flash` | Gemini model to use                                          |
| `GEMINI_MAX_LENGTH`   | no       | `600`              | Total response budget in characters                          |
| `GEMINI_CHUNK_SIZE`   | no       | `200`              | Max chars per message; longer replies are split into chunks  |

### Choosing a model

| Model                  | Speed  | Quality | Notes                        |
|------------------------|--------|---------|------------------------------|
| `gemini-2.0-flash`     | fast   | good    | Default, free tier available |
| `gemini-2.0-flash-lite`| faster | lighter | Lower cost / higher quota    |
| `gemini-2.5-pro`       | slower | best    | Paid tier                    |

## Message length and splitting

Meshtastic text messages are limited to approximately 228 bytes.
`GEMINI_CHUNK_SIZE` (default `200`) is the per-message limit; responses longer
than this are split into multiple messages sent sequentially.

Splitting is word-boundary-aware: each chunk ends after the last whole word that
fits, followed by a `…` suffix. The final chunk has no suffix.

`GEMINI_MAX_LENGTH` (default `600`) caps the total response before splitting.
Gemini is also instructed via a system prompt to keep its reply under this limit,
so most responses arrive already concise.

```
# Example: 450-char reply → 3 messages
msg 1: "LoRa (Long Range) is a wireless modulation…"   ← ≤200 chars
msg 2: "…technique that trades data rate for range…"    ← ≤200 chars
msg 3: "…and is widely used in IoT devices."            ← remainder
```

## Disabling the plugin

Remove or rename the file to stop it from loading:

```bash
mv plugins/gemini.js plugins/gemini.js.disabled
```

## Changing the trigger

```env
# .env
GEMINI_TRIGGER_TEXT=Hey Gemini,
```

The trigger is case-sensitive and must include any trailing space or punctuation
you want as part of the prefix.
