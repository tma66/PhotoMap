# Instructions for Building a Polarsteps Web Replica

## System Prompt & Context

You are an expert full-stack developer tasked with building a web application replica of **Polarsteps** (`polarsteps.com`). The application must run locally and provide an interactive travel journal, route tracker, and trip viewer.

---

## Technical Stack Requirements

- **Frontend Framework:** Next.js (App Router, React, TypeScript).
- **Styling:** Tailwind CSS with custom theme extensions (Polarsteps dark navy background `#0F172A`, vibrant seafoam accent `#00D2A0`, warm coral accent `#FF5A5F`).
- **Map Engine:** Mapbox GL JS or Leaflet (using MapLibre GL for open-source vector tiles) with custom dark map style.
- **Database & Persistence:** SQLite via Prisma ORM or local JSON/Dexie.js indexed storage.
- **State Management:** Zustand or React Context for managing active trip, current step selection, and modal state.
- **Icons:** Lucide React (`MapPin`, `Compass`, `Calendar`, `Camera`, `Globe`, `Navigation`, `Plus`, `X`, `Share2`, `Heart`).

---

## Visual Design & UI System

### Color Palette

- **Primary Background:** `#0B132B` (Deep Night Ocean)
- **Card & Overlay Surface:** `#1C2541` (Slate Navy with subtle border opacity)
- **Accent Primary:** `#00D2A0` (Polarsteps Seafoam Green)
- **Accent Secondary:** `#FF5A5F` (Vibrant Coral / Pin Markers)
- **Text Main:** `#FFFFFF` (Pure White)
- **Text Muted:** `#94A3B8` (Slate Grey)

### Layout Architecture

1. **Split-Screen Interactive View (Default Trip View):**

- **Left Panel (40% width):** Scrollable Feed & Timeline containing trip metadata, stats, and chronological "Steps".
- **Right Panel (60% width):** Full-height interactive 3D/2D vector map displaying the connected GPS path and animated location pins.

2. **Top Navigation Bar:** Transparent-to-dark glassmorphic navbar with Logo, Search/Explore link, "My Trips", User Profile avatar, and "New Trip" CTA button.

---

## Key Functional Modules

### 1. Interactive World Map & Route Renderer

- Render a custom dark-mode world map with glowing route lines connecting trip "Steps".
- Curved geodesic polylines between locations (simulating flight paths) and straight/curved land routes.
- Custom pin markers on the map corresponding to each trip step:
- Numbered or thumbnail-backed pins.
- Pulsing animated dot for the current/latest step.
- Hover tooltip showing Step Title, Date, and Cover Photo.

- Clicking a pin on the map smoothly pans/zooms to that coordinate and scrolls the left feed to the corresponding step.

### 2. Trip Overview & Statistics

Every trip must display aggregated stats at the top of the timeline:

- **Total Distance Covered** (in km / miles).
- **Countries Visited Count** + Flag icons.
- **Trip Duration** (e.g., "14 Days", start/end dates).
- **Step Count** (e.g., "12 Steps").

### 3. Chronological Trip Timeline ("Steps")

- Timeline feed displaying posts ("Steps") in chronological order.
- Each Step card contains:
- Location Title (e.g., "Shibuya Crossing, Tokyo, Japan").
- Timestamp / Date.
- Photo & Video carousel grid.
- Journal entry body text.
- Weather tag / Transport mode icon (e.g., Flight, Train, Car, Walk).
- GPS coordinates.

### 4. Step Creation & Editing Workflow

- Floating Action Button (`+ Add Step`) opens a modal:
- **Location Picker:** Interactive map click or search bar (geocoding via Mapbox/OpenStreetMap Nominatim API).
- **Date & Time Selector**.
- **Photo Upload:** Drag-and-drop file uploader with image preview grid.
- **Transport Method Selector:** Plane, Train, Car, Bus, Boat, Bicycle, Foot.
- **Journal Text Input:** Markdown or rich text editor.
- Auto-calculates distance from previous step and redraws the map path upon saving.

---

## Database Schema (Prisma / TypeScript Interface)

```typescript
interface User {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  bio: string;
}

interface Trip {
  id: string;
  userId: string;
  title: string;
  description: string;
  coverImageUrl: string;
  startDate: string; // ISO Date
  endDate?: string;
  isPublic: boolean;
  steps: Step[];
}

interface Step {
  id: string;
  tripId: string;
  title: string;
  locationName: string;
  latitude: number;
  longitude: number;
  countryCode: string; // e.g. "JP", "FR"
  arrivedAt: string; // ISO Date
  journalText: string;
  transportMode: "FLIGHT" | "TRAIN" | "CAR" | "BOAT" | "FOOT" | "BIKE";
  media: MediaItem[];
}

interface MediaItem {
  id: string;
  stepId: string;
  url: string;
  type: "IMAGE" | "VIDEO";
}
```

---

## Step-by-Step Implementation Instructions for Claude

1. **Scaffold Next.js App:** Initialize a Next.js App Router project with Tailwind CSS, TypeScript, and Lucide icons.
2. **Setup Map Container:** Integrate MapLibre GL / Mapbox with a dark vector tile style. Implement smooth flyTo animations when clicking points.
3. **Build Core Layout:** Implement the 40/60 split-screen layout with a responsive drawer for mobile screens (map toggles to full screen or top half).
4. **Mock Initial Data:** Provide pre-populated sample trip data (e.g., "3 Weeks in Japan") with 5-10 realistic steps, GPS points, photo URLs, and journal entries so the UI looks complete out of the box.
5. **Implement Route Math:** Add a utility function to compute the curved line string (Turf.js or great-circle calculations) between consecutive step coordinates to render the signature Polarsteps route path.
6. **Build Step Creator:** Implement the `Add Step` modal form with geocoding, photo preview, and route updating logic.
7. **Refine Visual Polish:** Apply glassmorphism backgrounds (`backdrop-blur-md bg-slate-900/80`), custom scrollbars, glowing teal accents (`#00D2A0`), and smooth hover transitions on cards and pins.
