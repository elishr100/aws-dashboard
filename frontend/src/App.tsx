import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Resources } from './pages/Resources'
import { Scan } from './pages/Scan'
import { Security } from './pages/Security'
import { Alerts } from './pages/Alerts'
import Organization from './pages/Organization'
import Analytics from './pages/Analytics'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/security" element={<Security />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/organization" element={<Organization />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </Layout>
  )
}

export default App
