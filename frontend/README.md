# AWS Dashboard - Frontend

Modern React frontend for the AWS Cloud Governance Dashboard.

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

### Development
```bash
npm run dev
# Runs on http://localhost:3000
# API proxy to http://localhost:3001
```

### Build
```bash
npm run build
# Outputs to dist/
```

### Preview Production Build
```bash
npm run preview
```

## 📁 Project Structure

```
src/
├── components/
│   ├── ui/              # Reusable UI components
│   ├── Layout.tsx       # Main layout
│   ├── Sidebar.tsx      # Navigation
│   ├── AccountSwitcher.tsx
│   └── SessionBanner.tsx
├── context/
│   ├── AppContext.tsx   # Global state
│   └── ToastContext.tsx # Notifications
├── lib/
│   ├── api.ts           # API client
│   └── utils.ts         # Utilities
├── pages/
│   ├── Dashboard.tsx    # Dashboard page
│   ├── Resources.tsx    # Resources page
│   └── Scan.tsx         # Scan page
├── types/
│   └── index.ts         # TypeScript types
└── main.tsx             # Entry point
```

## 🎨 Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Routing
- **TanStack Query** - Data fetching
- **Axios** - HTTP client
- **Lucide React** - Icons

## 📊 Pages

### Dashboard (`/`)
- Resource statistics overview
- Distribution by type and region
- Accounts overview

### Resources (`/resources`)
- Searchable resource table
- Advanced filtering
- Resource state badges

### Scan (`/scan`)
- Region selection
- Real-time scan progress
- SSE streaming updates

## 🔌 API Integration

Backend runs on `http://localhost:3001`. Vite proxies `/api` requests.

### Endpoints
- `GET /api/accounts` - List accounts
- `GET /api/session/status` - Session status
- `POST /api/session/refresh` - Refresh session
- `POST /api/scan` - Start scan
- `GET /api/scan/:jobId/stream` - SSE stream
- `GET /api/resources` - Get resources
- `GET /api/resources/stats` - Get stats

## 🎯 Features

- ✅ Real-time updates via SSE
- ✅ Toast notifications
- ✅ Session monitoring
- ✅ Account switching (20 accounts)
- ✅ Resource filtering
- ✅ Responsive design
- ✅ Loading states
- ✅ Error handling

## 📦 Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Lint code

## 🌐 Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

---

**Built with ❤️ using Claude Code**
