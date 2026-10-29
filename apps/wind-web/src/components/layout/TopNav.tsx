export function TopNav() {
  return (
    <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 sticky top-0 z-10" role="banner">
      <div className="max-w-screen-2xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">Wind Power Forecast Analytics</h1>
          <span className="hidden md:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200">
            UK Day-Ahead Procurement
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span className="hidden sm:inline">Data: Elexon BMRS (FUELHH + WINDFOR)</span>
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <time dateTime={new Date().toISOString()}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })}
            </time>
          </span>
        </div>
      </div>
    </header>
  );
}