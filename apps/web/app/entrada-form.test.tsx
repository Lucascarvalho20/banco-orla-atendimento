import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EntradaForm } from './entrada-form';

const API = 'http://localhost:4000';

function mockFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const onStart = vi.fn();

async function preencher(cpf = '52998224725') {
  onStart.mockReset();
  const user = userEvent.setup();
  render(<EntradaForm apiUrl={API} onStart={onStart} />);
  await user.type(screen.getByLabelText('Nome'), 'Ana Lima');
  await user.type(screen.getByLabelText('CPF'), cpf);
  await user.selectOptions(screen.getByLabelText('Assunto'), 'pix');
  return user;
}

describe('EntradaForm', () => {
  it('formata o CPF enquanto a pessoa digita', async () => {
    await preencher();
    expect(screen.getByLabelText('CPF')).toHaveValue('529.982.247-25');
  });

  it('CPF inválido mostra erro e não chama o servidor', async () => {
    const fetchMock = mockFetch(201);
    const user = await preencher('52998224726');
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(screen.getByText('CPF inválido. Confira os números.')).toBeInTheDocument();
    expect(screen.getByLabelText('CPF')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('o erro do CPF some quando a pessoa corrige o campo', async () => {
    mockFetch(201);
    const user = await preencher('52998224726');
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));
    expect(screen.getByText('CPF inválido. Confira os números.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('CPF'), '{Backspace}5');
    expect(screen.queryByText('CPF inválido. Confira os números.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('CPF')).toHaveAttribute('aria-invalid', 'false');
  });

  it('envia só dígitos, com cookie, e inicia o atendimento', async () => {
    const fetchMock = mockFetch(201, { displayName: 'Ana Lima', cpfLast2: '25' });
    const user = await preencher();
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        displayName: 'Ana Lima',
        cpfLast2: '25',
        topic: 'pix',
        preferential: false,
      }),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/sessions`);
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ana Lima',
      cpf: '52998224725',
      topic: 'pix',
      preferential: false,
    });
  });

  it('avisa quando o servidor limita as tentativas (429)', async () => {
    mockFetch(429);
    const user = await preencher();
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas');
  });

  it('mostra erro genérico se o servidor estiver fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const user = await preencher();
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível iniciar');
  });
});
