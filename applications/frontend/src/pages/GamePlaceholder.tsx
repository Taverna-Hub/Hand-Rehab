export function GamePlaceholder() {
  return (
    <main className="min-h-screen bg-stone-50 text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-sm font-medium text-teal-700">Hand Rehab MVP</p>
            <h1 className="mt-1 text-2xl font-semibold">Frontend em desenvolvimento</h1>
          </div>
          <div className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-800">
            Base tecnica
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-8 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Jogo</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Placeholder reservado para a futura tela de ritmo e selecao de sessao.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Realtime</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Estrutura pronta para consumir o WebSocket do Node-RED.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Dashboard</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Fora do escopo deste ciclo; os dados historicos ficam no backend.
          </p>
        </div>
      </section>
    </main>
  );
}
