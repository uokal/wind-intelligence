import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { MemoryRouter } from 'react-router-dom';

test('Sidebar renders navigation', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
    </MemoryRouter>
  );
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});