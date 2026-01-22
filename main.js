// main.js — UI behavior with safety checks and cross-page active-link handling
// - Added guards so pages without specific elements don't throw
// - Active-link logic now handles both same-page anchors (#id) and separate .html pages
// - Small comments explain intent

// Mobile Menu Toggle (guarded)
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
}

/* Close mobile menu when clicking a link (guarded)
   - Also set the clicked link as active immediately to preserve the underline
     for single-page navigation or when the menu is closed (mobile behavior).
*/
const navLinks = document.querySelectorAll('.nav-link');
if (navLinks && navLinks.length) {
    navLinks.forEach(link => link.addEventListener('click', (e) => {
        // set active state immediately for user feedback (underline)
        navLinks.forEach(l => l.classList.remove('active'));
        try {
            // e.currentTarget is the clicked element (fallback to e.target)
            const clicked = e.currentTarget || e.target;
            if (clicked && clicked.classList) clicked.classList.add('active');
        } catch (err) {
            // no-op if event shape unexpected
        }

        // close mobile menu if open
        if (hamburger && navMenu) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        }

        // Re-run the active-link logic after a short delay to ensure
        // page/path updates (or mobile menu transitions) don't remove the active state.
        // This prevents the "disappear" issue when clicking the current page link.
        setTimeout(() => {
            try {
                updateActiveNavOnScroll();
            } catch (err) {
                // ignore if function not available for some pages
            }
        }, 60);
    }));
}

// Helper: determine "current" section id based on scroll (for index) or URL (for other pages)
function updateActiveNavOnScroll() {
    const sections = document.querySelectorAll('section');
    if (!sections || sections.length === 0) return;

    let current = '';

    sections.forEach(section => {
        const rectTop = section.offsetTop;
        const rectHeight = section.clientHeight;
        if (window.scrollY >= rectTop - rectHeight / 3) {
            current = section.getAttribute('id') || '';
        }
    });

    // Update nav links: handles anchors (#id) and full-page links (.html)
    navLinks.forEach(link => {
        link.classList.remove('active');

        const href = link.getAttribute('href') || '';
        // same-page anchor
        if (href.startsWith('#') && current && href.includes(current)) {
            link.classList.add('active');
        } else {
            // cross-page: compare pathname (e.g., leaderboard.html) with current location
            try {
                const linkUrl = new URL(href, window.location.origin);
                const currentPage = window.location.pathname.split('/').pop(); // index.html or '' for root
                const linkPage = linkUrl.pathname.split('/').pop();

                if (linkPage && currentPage && linkPage === currentPage) {
                    link.classList.add('active');
                }
            } catch (e) {
                // ignore malformed URLs
            }
        }
    });
}

// Run on scroll, if sections exist
if (document.querySelectorAll('section').length) {
    window.addEventListener('scroll', updateActiveNavOnScroll);
    // also run once to initialize state
    updateActiveNavOnScroll();
}

// Smooth Scroll for CTA Button (guarded)
const cta = document.querySelector('.cta-button');
if (cta) {
    cta.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);
        if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth' });
        }
    });
}

// Navbar Background Change on Scroll (guarded)
const navbar = document.querySelector('.navbar');
if (navbar) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.15)';
        } else {
            navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        }
    });
}

// Add entrance animation to sections (guarded)
const observerOptions = {
    threshold: 0.2,
    rootMargin: '0px'
};

const sectionsForObserver = document.querySelectorAll('.section');
if (sectionsForObserver && sectionsForObserver.length) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    sectionsForObserver.forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });
}

/* Rankings interactions (minimal, non-invasive)
   - Row click navigates to profile (profile.html?user=..)
   - Simple client-side sort by Points when clicking the Points header (data-sortable="true")
   - All behavior is guarded so pages without the ranking table won't error
*/
(function(){
    const rankTable = document.querySelector('.rank-table');
    if (!rankTable) return;

    // Row click -> profile (uses data-user attribute)
    rankTable.querySelectorAll('.rank-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            // allow clicking links inside the row to behave normally
            if (e.target && (e.target.tagName === 'A' || e.target.closest('a'))) return;
            const user = row.dataset.user;
            if (user) {
                // navigate to profile page for now
                window.location.href = `profile.html?user=${encodeURIComponent(user)}`;
            }
        });
    });

    // Simple Points sorting (toggles asc/desc). Keeps top-3 visual order when sorting (they move with rows).
    const pointsHeader = rankTable.querySelector('th[data-sortable]');
    if (pointsHeader) {
        pointsHeader.style.cursor = 'pointer';
        pointsHeader.addEventListener('click', () => {
            const tbody = rankTable.querySelector('tbody');
            if (!tbody) return;
            const currentDir = pointsHeader.dataset.sortDir === 'desc' ? 'desc' : 'asc';
            const nextDir = currentDir === 'desc' ? 'asc' : 'desc';
            pointsHeader.dataset.sortDir = nextDir;

            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((a, b) => {
                const paText = a.querySelector('.cell-points')?.textContent || '0';
                const pbText = b.querySelector('.cell-points')?.textContent || '0';
                const pa = parseInt(paText.replace(/[^\d]/g, ''), 10) || 0;
                const pb = parseInt(pbText.replace(/[^\d]/g, ''), 10) || 0;
                return nextDir === 'desc' ? pb - pa : pa - pb;
            });

            // Re-append rows in the new order
            rows.forEach(r => tbody.appendChild(r));
        });
    }
})();
