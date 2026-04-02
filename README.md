# Boligkøbsrådgiver

**AI-baseret køberrådgiver til boligkøb i Danmark.**

En browser-baseret web-app, der forbinder dig direkte til din foretrukne AI-tjeneste og hjælper dig med alle aspekter af boligkøb.

## Funktioner

- 🏡 **AI-baseret rådgivning** om tilstandsrapporter, finansiering, jura, prisforhandling m.v.
- 🔑 **Brug din egen API-nøgle** – understøtter OpenAI, Mistral AI, Azure OpenAI og brugerdefinerede OpenAI-kompatible endpoints
- 💾 **Alt gemmes lokalt** – data gemmes i browserens localStorage; intet sendes til servere
- 🕑 **Samtaleoversigt** – gem og genåbn tidligere samtaler
- 📱 **Responsivt design** – fungerer på desktop og mobil

## Kom i gang

### Krav

Ingen installation nødvendig. Du skal blot bruge:

- En moderne webbrowser (Chrome, Firefox, Edge, Safari)
- En API-nøgle fra en understøttet AI-tjeneste

### Understøttede AI-udbydere

| Udbyder | Model eksempler | Nøgle/endpoint |
|---|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-3.5-turbo | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Mistral AI** | mistral-large, mistral-small | [console.mistral.ai](https://console.mistral.ai/api-keys/) |
| **Azure OpenAI** | Valgfrit deployment | Azure Portal |
| **Brugerdefineret** | Ethvert OpenAI-kompatibelt API | Eget endpoint |

### Kørsel

Åbn `index.html` direkte i browseren, eller server mappen med en simpel HTTP-server:

```bash
# Python
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Naviger til `http://localhost:8080` og klik på **Indstillinger** for at tilføje din API-nøgle.

### GitHub Pages

Projektet kan hostes direkte på GitHub Pages ved at aktivere Pages på `main`-branchen.

## Projektstruktur

```
index.html          Hoved-HTML med app-skabelon
css/
  style.css         Al styling
js/
  storage.js        LocalStorage-hjælpefunktioner
  api.js            Multi-provider AI API-klient
  app.js            Applikationslogik (chat, indstillinger m.v.)
```

## Privatlivspolitik

- Din API-nøgle gemmes **kun** i din browsers localStorage.
- Samtaler gemmes **kun** lokalt i din browser.
- Al kommunikation med AI-tjenesten sker **direkte** fra din browser til udbyderens API.
- Der sendes ingen data til denne applikations servere, da der ikke er nogen.
