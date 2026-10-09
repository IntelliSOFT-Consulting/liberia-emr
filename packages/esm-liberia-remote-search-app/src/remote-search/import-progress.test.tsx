import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ImportProgress from './import-progress.component';
import { importProgressStore, type ImportSteps } from './run-import';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const renderWith = (steps: ImportSteps) => {
  importProgressStore.setState({ steps });
  return render(
    <ImportProgress patientName="Jane Doe" age="29 Years" birthdate="11-Jan-1997" identifier="OpenMRS ID: 1001396" />,
  );
};

describe('import progress dialog', () => {
  it('shows the patient under IMPORTING RECORD (2c)', () => {
    renderWith(['active', 'pending', 'pending']);

    expect(screen.getByText('IMPORTING RECORD')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('29 Years')).toBeInTheDocument();
    expect(screen.getByText('11-Jan-1997')).toBeInTheDocument();
    expect(screen.getByText('OpenMRS ID: 1001396')).toBeInTheDocument();
  });

  it('lists the three steps and marks the running one', () => {
    renderWith(['done', 'done', 'active']);

    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Connecting to National Registry...',
      'Fetching Patient Record...',
      'Importing to local system',
    ]);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).not.toHaveAttribute('aria-current');
  });

  it('reports progress to assistive technology', () => {
    const { container } = renderWith(['done', 'done', 'active']);

    expect(screen.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute('aria-valuenow', '83');
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
  });

  it('has no close button and stops Escape from reaching the modal system', () => {
    renderWith(['active', 'pending', 'pending']);
    // The modal system closes the top modal from a bubbling keydown listener on window.
    const modalSystem = jest.fn();
    window.addEventListener('keydown', modalSystem);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(modalSystem).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    window.removeEventListener('keydown', modalSystem);
  });

  it('lets Escape through again once it has closed', () => {
    const { unmount } = renderWith(['done', 'done', 'done']);
    unmount();
    const modalSystem = jest.fn();
    window.addEventListener('keydown', modalSystem);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(modalSystem).toHaveBeenCalled();
    window.removeEventListener('keydown', modalSystem);
  });
});
