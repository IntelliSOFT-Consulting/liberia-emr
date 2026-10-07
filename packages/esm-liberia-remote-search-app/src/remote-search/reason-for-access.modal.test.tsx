import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ReasonForAccessModal from './reason-for-access.modal';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

const renderModal = () => {
  const close = jest.fn();
  const onConfirm = jest.fn();
  render(<ReasonForAccessModal close={close} onConfirm={onConfirm} />);
  return { close, onConfirm, confirmButton: () => screen.getByRole('button', { name: 'Import & Open' }) };
};

describe('reason for access modal', () => {
  it('shows the question, the four reasons and the audit notice, with Import & Open disabled (2a)', () => {
    const { confirmButton } = renderModal();

    expect(screen.getByText('Why are you opening this record?')).toBeInTheDocument();
    for (const label of ['Visiting patient', 'Referral in', 'Emergency', 'Other']) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    }
    expect(screen.getByText('Your name, the reason and the time of this access are recorded.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Describe the reason')).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('confirms a fixed reason straight away', () => {
    const { close, onConfirm, confirmButton } = renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Referral in' }));
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    expect(close).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith('Referral in');
  });

  it('asks for details with Other and enables Import & Open once they are typed (2b)', () => {
    const { onConfirm, confirmButton } = renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    const details = screen.getByLabelText('Describe the reason');
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(details, { target: { value: '   ' } });
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(details, { target: { value: 'Seen at outreach session; needs ANC record' } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith('Other: Seen at outreach session; needs ANC record');
  });

  it('cancels without confirming anything', () => {
    const { close, onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Emergency' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(close).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not confirm on submit (Enter) before a reason is valid', () => {
    const { onConfirm } = renderModal();

    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.submit(screen.getByLabelText('Describe the reason').closest('form'));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
