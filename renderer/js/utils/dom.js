/**
 * Create a DOM element with attributes and children.
 * h('div', { class: 'foo' }, [h('span', {}, 'text')])
 */
function h(tag, attrs, children) {
  const el = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(value)) {
          el.dataset[dk] = dv;
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value);
      }
    }
  }

  if (children !== undefined && children !== null) {
    if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'string') {
          el.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
          el.appendChild(child);
        }
      }
    } else if (typeof children === 'string') {
      el.textContent = children;
    } else if (children instanceof Node) {
      el.appendChild(children);
    }
  }

  return el;
}
