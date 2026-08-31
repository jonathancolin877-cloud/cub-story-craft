# Global Animal Tales

Build a web app called "Mawil Kids Global Factory - Little Zoologists of the World"

Goal: Input an animal + region, output complete kids book + promo videos ready to publish on Amazon and YouTube.

FEATURES NEEDED:

1. LEFT PANEL - Input Form:
- Dropdown Region: India (default), MENA, Europe, USA
- Dropdown Animal: Auto-suggest based on region (India: Tiger, Elephant, Peacock / MENA: Oryx, Falcon, Gazelle / Europe: Fox, Bear, Wolf / USA: Eagle, Bison, Wolf)
- Age: 3-5 years (default)
- Language: Auto dual - English + Hindi (for India first)
- Value: Courage, Patience, Kindness, Teamwork
- Button: "Generate Book Package"

2. MIDDLE PANEL - Book Preview (24 pages):
- For each page show: illustration placeholder + 1 short sentence (max 12 words) in English + Hindi + Fact Box (real zoology fact about animal)
- Story arc: Page 1-3 intro, 4-18 challenge (little animal scared to cross forest/river), 19-22 learns lesson, 23-24 moral + positive affirmation
- Character consistency: Use same prompt base for all images: "cute baby, big eyes, consistent character, kids book illustration, soft colors, Pixar style --ar 4:3"
- Generate images with Lovable's image model

3. RIGHT PANEL - Export Package:
- Button 1: Export PDF - 24 pages + cover, ready for Amazon KDP India (8.5x8.5 inch)
- Button 2: Export YouTube Script - 3 min voiceover in English + Hindi, scene by scene from book pages
- Button 3: Export 3 Reels - 15 sec each with Hook + Fact + CTA "Get book on Amazon - link in bio" in Hindi + hashtags for India
- Button 4: Landing Page Link - simple page showing cover + Amazon buttons for http://Amazon.in

DESIGN: Cute, colorful, for Indian moms. Jungle green + bright colors, fun and warm. Hindi support.

First test: Generate Book 1 for India: Sheru the Tiger cub, Value=Courage, Language=English+Hindi

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://cub-story-craft.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5c7f6718-da29-4ac2-82bb-dea90bc32441).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
