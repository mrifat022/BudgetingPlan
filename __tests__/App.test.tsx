/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../src/services/firebase', () => ({
  listenToAuth: (next: (user: null) => void) => {
    next(null);
    return () => undefined;
  },
  login: jest.fn(),
  logout: jest.fn(),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
