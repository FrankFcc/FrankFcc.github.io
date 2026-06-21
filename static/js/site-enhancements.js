(function () {
  var revealItems = document.querySelectorAll('.stream-item, .cf-quick-card, .article, .anime-card');
  if (!('IntersectionObserver' in window)) {
    revealItems.forEach(function (item) {
      item.classList.add('is-visible');
    });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

  revealItems.forEach(function (item) {
    item.classList.add('reveal-item');
    if (item.getBoundingClientRect().top < window.innerHeight * 0.95) {
      item.classList.add('is-visible');
    }
    observer.observe(item);
  });
})();
