const updatedAt = document.getElementById('updated-at');
if (updatedAt) {
  updatedAt.textContent = new Date().toLocaleString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

const blocks = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.14 }
);

blocks.forEach((block) => observer.observe(block));
