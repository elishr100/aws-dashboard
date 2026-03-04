import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Database, ScanLine, Cloud, Shield, Bell, Building2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Resources', href: '/resources', icon: Database },
  { name: 'Scan', href: '/scan', icon: ScanLine },
  { name: 'Security', href: '/security', icon: Shield },
  { name: 'Alerts', href: '/alerts', icon: Bell },
  { name: 'Organization', href: '/organization', icon: Building2 },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <div className="flex h-screen w-64 flex-col bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-6 border-b border-gray-800">
        <Cloud className="h-8 w-8 text-blue-400" />
        <div>
          <h1 className="text-lg font-semibold">AWS Dashboard</h1>
          <p className="text-xs text-gray-400">Cloud Governance</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 p-4">
        <p className="text-xs text-gray-500">
          Powered by Claude MCP
        </p>
      </div>
    </div>
  );
}
