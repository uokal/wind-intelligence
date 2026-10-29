import { NavLink } from 'react-router-dom';

export function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-6 text-xl font-bold">Wind Analytics</div>
      <nav className="flex-1">
        <ul className="space-y-2 px-4">
          <li>
            <NavLink
              to="/"
              className={({ isActive }) =>
                `block px-4 py-2 rounded ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}`
              }
            >
              Dashboard
            </NavLink>
          </li>
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-700 text-xs text-gray-400">
        v0.1.0
      </div>
    </aside>
  );
}