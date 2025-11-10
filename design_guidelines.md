# Milo - AI-Powered Trucking Management Platform
## Design Guidelines

### Design Approach: Modern Operations Platform
**Selected System**: Material Design 3 principles + Linear-inspired productivity aesthetics
**Rationale**: Data-dense operations platform requiring clarity, efficiency, and systematic information hierarchy. The AI-first interface needs to feel modern and approachable while handling complex scheduling data.

**Core Principles**:
- Information density over visual decoration
- AI conversation as primary interaction pattern
- Systematic data presentation with clear visual hierarchies
- Efficient workflows for rapid decision-making

---

## Typography System

**Font Stack**: Inter (Google Fonts) for UI, JetBrains Mono for data/timestamps
- **Hero/Page Headers**: Inter 700 (Bold), text-4xl to text-5xl
- **Section Headers**: Inter 600 (Semibold), text-2xl to text-3xl
- **Subsection Headers**: Inter 600 (Semibold), text-lg to text-xl
- **Body Text**: Inter 400 (Regular), text-base
- **UI Labels**: Inter 500 (Medium), text-sm
- **Data/Timestamps**: JetBrains Mono 400, text-sm
- **AI Chat Messages**: Inter 400, text-base with medium line-height for readability

---

## Layout System

**Spacing Primitives**: Tailwind units of **2, 4, 8, 12, 16**
- Tight spacing: p-2, gap-2 (data tables, compact lists)
- Standard spacing: p-4, gap-4 (cards, form fields)
- Section spacing: p-8, gap-8 (major layout divisions)
- Page margins: p-12 (desktop containers)
- Generous spacing: p-16 (landing page sections)

**Grid Structure**:
- Dashboard: 12-column grid with sidebar (col-span-3) + main content (col-span-9)
- Data tables: Full-width with horizontal scroll on mobile
- AI Chat: Centered column max-w-4xl for conversation flow
- Forms: 2-column layout (md:grid-cols-2) with full-width on mobile

---

## Component Library

### Core Navigation
**Primary Navigation**: Persistent left sidebar (280px width)
- Milo AI chat icon prominent at top
- Dashboard, Drivers, Schedules, Predictions, Compliance sections
- Tenant switcher at bottom for multi-tenant access

**Top Bar**: Sticky header with tenant name, notifications, user profile

### AI Interface Components
**Milo Chat Window**: 
- Floating chat icon (bottom-right) that expands to overlay (mobile) or sidebar panel (desktop)
- Message bubbles with clear user/AI distinction through layout (not color)
- Function call results displayed as embedded data cards
- Typing indicators and timestamp badges

**AI Command Suggestions**: Pill-shaped quick actions below chat input

### Data Display Components
**Schedule Calendar**:
- Week view as primary layout (7-column grid)
- Block cards showing Block ID, Solo type, start/end times, driver assignment
- Drag-drop target zones with dashed borders
- Duty-day indicators per driver row

**Data Tables**:
- Dense row spacing (h-12) with hover states
- Sortable column headers with icons
- Inline editing capabilities for assignments
- Status badges (on-bench, off-bench, protected driver)

**Driver Cards**:
- Compact horizontal layout: avatar + name + current assignment + rolling-6 status
- Protected driver indicator badge
- Quick-assign dropdown

**File Upload Zone**:
- Large drop target area (min-h-64) with dashed border
- Icon (upload cloud) + "Drag CSV/Excel here or click to browse"
- File preview table after upload showing parsed data
- Validation warnings displayed inline

### Forms & Inputs
**Form Fields**: Consistent height (h-12), rounded corners (rounded-lg)
**Labels**: Above field, Inter Medium text-sm
**Helper Text**: Below field, text-xs
**Error States**: Text messaging with icon, not just border treatment

### Overlays & Modals
**Modal Dialogs**: Centered overlay with max-w-2xl, backdrop blur
**Confirmation Dialogs**: Compact max-w-md with clear action buttons
**Side Panels**: Slide-in from right (w-96) for detailed views

---

## Visual Hierarchy Patterns

**Information Density Levels**:
1. **Dashboard Overview**: Medium density - key metrics cards (4-column grid lg:grid-cols-4)
2. **Schedule View**: High density - maximize visible blocks per viewport
3. **AI Chat**: Low density - comfortable reading with generous line-height
4. **Data Tables**: High density - compact rows, visible scrollbar

**Card Design**:
- Subtle borders (border-1) rather than heavy shadows
- Consistent padding (p-4 to p-6)
- Header with title + action button in same row
- Content area with appropriate data density

**Status Indicators**:
- Badge components for: DOT compliant, protected driver, off-bench, carryover
- Icon + text combination for clarity
- Positioned top-right in cards or inline in tables

---

## Landing/Marketing Pages

**Hero Section** (h-screen with centered content):
- Large hero image: Modern trucking dashboard screenshot or AI interface visualization
- Headline: "AI-Powered Trucking Operations" (text-5xl font-bold)
- Subheadline explaining Milo AI assistant
- Primary CTA: "Start Free Trial" + Secondary: "Watch Demo"
- Floating trust indicator: "DOT Compliant Scheduling"

**Feature Sections** (5-8 sections, py-20):
1. **AI Assistant**: 2-column (image of Milo chat + feature list)
2. **Smart Scheduling**: 3-column grid showing key features with icons
3. **Drag & Drop**: Full-width screenshot showing CSV upload interface
4. **Compliance**: 2-column (compliance metrics + visual dashboard)
5. **Predictions**: Feature showcase with ML prediction heatmap visual
6. **Multi-Tenant**: Enterprise feature callout
7. **Testimonials**: 3-column grid with customer logos
8. **CTA Section**: Centered with pricing tiers (3-column comparison table)

**Footer**: Rich footer with product links, company info, resources, contact, newsletter signup

---

## Images

**Hero Image**: Dashboard screenshot showing Milo AI chat interface alongside schedule calendar - demonstrates product in action (full-width background image with overlay gradient)

**Feature Images**: 
- AI chat conversation example (natural conversation with Milo)
- Drag-drop upload interface showing CSV parsing
- Schedule calendar with block assignments
- Compliance dashboard with rolling-6 visualization
- ML prediction heatmap

**Placement**: Hero background, alternating left/right in feature sections, embedded in product showcases

---

## Responsive Behavior

**Breakpoints**:
- Mobile (base): Single column, stacked navigation, full-width tables with horizontal scroll
- Tablet (md): 2-column layouts, collapsible sidebar
- Desktop (lg+): Full multi-column grids, persistent sidebar

**Mobile Adaptations**:
- Bottom navigation bar replacing sidebar
- AI chat as full-screen overlay
- Drag-drop simplified to file picker button
- Tables scroll horizontally with sticky first column