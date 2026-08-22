/* =============================================================================
   LIV · Eventos de conversão para o dataLayer (Google Tag Manager)
   -----------------------------------------------------------------------------
   Este arquivo NÃO envia nada para lugar nenhum sozinho. Ele apenas registra o
   que o visitante faz no dataLayer. Quem decide o que fazer com isso é o GTM,
   pelos acionadores que você criar no painel.

   Eventos publicados:
     clique_whatsapp      { origem, pagina }              todo link para wa.me
     interesse_marca      { marca, pagina }               botão "Tenho interesse"
     ver_detalhes_marca   { marca }                       vira o card da marca
     viabilidade_enviada  { marca }                       formulário de viabilidade
     newsletter_inscrita  { pagina }                      caixa da newsletter
     adesao_assinada      { marca, situacao }             termo de adesão assinado
   ============================================================================= */
(function () {
  window.dataLayer = window.dataLayer || [];

  const paginaAtual = () => (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';

  function push(evento, dados) {
    window.dataLayer.push(Object.assign({ event: evento, pagina: paginaAtual() }, dados || {}));
  }
  window.livEvento = push; // permite disparos pontuais de outras páginas

  /* de onde partiu o clique no WhatsApp: usa o id do botão ou a seção em volta */
  const ORIGEM_POR_ID = {
    navWa: 'menu', heroWa: 'hero', footWa: 'rodape', waFoot: 'rodape',
    waFloat: 'botao-flutuante', waVender: 'quero-vender', waComprar: 'quero-comprar',
    waRegistro: 'registro', waDefesa: 'defesa', waAviso: 'aviso-catalogo',
    waCatalogo: 'catalogo-whatsapp', waAnunciar: 'anunciar-marca', waQuem: 'quem-somos',
    waPriv: 'privacidade', waLink: 'viabilidade-enviar'
  };
  function origemDoClique(a) {
    if (a.id && ORIGEM_POR_ID[a.id]) return ORIGEM_POR_ID[a.id];
    if (a.classList.contains('js-wa-interesse')) return 'card-marca';
    const sec = a.closest('section[id]');
    if (sec) return sec.id;
    if (a.closest('footer')) return 'rodape';
    if (a.closest('header')) return 'menu';
    return 'outro';
  }

  function nomeDaMarca(el) {
    const card = el.closest('.mk-card');
    if (!card) return '';
    const n = card.querySelector('.mk-name');
    return n ? n.textContent.trim() : '';
  }

  document.addEventListener('click', function (e) {
    const a = e.target.closest('a');

    /* 1) qualquer link de WhatsApp */
    if (a && /(?:wa\.me|api\.whatsapp\.com)/.test(a.href || '')) {
      const marca = nomeDaMarca(a);
      push('clique_whatsapp', marca ? { origem: origemDoClique(a), marca: marca } : { origem: origemDoClique(a) });

      /* 2) interesse numa marca do catálogo */
      if (a.classList.contains('js-wa-interesse') && marca) push('interesse_marca', { marca: marca });
      return;
    }

    /* 3) abriu os detalhes de uma marca (o card vira) */
    const card = e.target.closest('.mk-card');
    if (card && !card.classList.contains('flipped')) {
      const n = card.querySelector('.mk-name');
      if (n) push('ver_detalhes_marca', { marca: n.textContent.trim() });
    }
  }, true);

  /* 4) formulário de viabilidade (home): dispara quando a tela de sucesso aparece */
  const sucesso = document.getElementById('formSuccess');
  if (sucesso && window.MutationObserver) {
    new MutationObserver(function (muts, obs) {
      if (sucesso.classList.contains('show')) {
        const m = document.getElementById('vMarca');
        push('viabilidade_enviada', { marca: m ? (m.value || '').trim() : '' });
        obs.disconnect();
      }
    }).observe(sucesso, { attributes: true, attributeFilter: ['class'] });
  }

  /* 5) newsletter (home e blog) */
  const nl = document.getElementById('nlBtn');
  if (nl) nl.addEventListener('click', function () {
    const email = (document.getElementById('nlEmail') || {}).value || '';
    if (/^\S+@\S+\.\S+$/.test(email.trim())) push('newsletter_inscrita', {});
  });
})();
