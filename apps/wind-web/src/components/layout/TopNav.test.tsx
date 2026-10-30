import { act, fireEvent, render, screen } from '@testing-library/react';
import { TopNav } from './TopNav';

const props = {
  apiConnected: true,
  lastRefresh: null,
  onRefresh: vi.fn(),
  loading: false,
};

test('refresh has an accessible name and calls the handler', () => {
  render(<TopNav {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent('API Connected');
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
});

test('loading disables refresh and disconnected status remains accessible', () => {
  render(
    <TopNav
      {...props}
      loading
      apiConnected={false}
      lastRefresh={new Date('2026-01-31T12:00:00Z')}
    />,
  );
  expect(screen.getByRole('button', { name: 'Refresh data' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('API Disconnected');
  expect(
    document.querySelector('time[datetime="2026-01-31T12:00:00.000Z"]'),
  ).toBeInTheDocument();
});

test('clock updates and interval is cleaned up', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const { unmount } = render(<TopNav {...props} />);
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  expect(document.querySelector('time')).toHaveAttribute(
    'datetime',
    '2026-01-01T12:01:00.000Z',
  );
  unmount();
  expect(clear).toHaveBeenCalled();
  clear.mockRestore();
  vi.useRealTimers();
});
