type EventEntry = { evt: string; hdlr: EventListenerOrEventListenerObject };

const eventMap = new WeakMap<HTMLTextAreaElement, EventEntry[]>();

const updateLineNumbers = (ta: HTMLTextAreaElement, wrapper: HTMLElement) => {
  const lineCount = ta.value.split("\n").length;
  const childCount = wrapper.children.length;
  let difference = lineCount - childCount;

  if (difference > 0) {
    const fragment = document.createDocumentFragment();
    while (difference > 0) {
      const line = document.createElement("span");
      line.className = "tln-line";
      fragment.appendChild(line);
      difference -= 1;
    }
    wrapper.appendChild(fragment);
  }

  while (difference < 0) {
    if (!wrapper.lastChild) break;
    wrapper.removeChild(wrapper.lastChild);
    difference += 1;
  }
};

export const appendLineNumbers = (ta: HTMLTextAreaElement) => {
  if (!ta || ta.classList.contains("tln-active")) return;
  const parent = ta.parentNode;
  if (!parent) return;

  ta.classList.add("tln-active");

  const wrapper = document.createElement("div");
  wrapper.className = "tln-wrapper";
  parent.insertBefore(wrapper, ta);
  updateLineNumbers(ta, wrapper);

  const listeners: EventEntry[] = [];
  eventMap.set(ta, listeners);

  const changeEvents = ["propertychange", "input", "keydown", "keyup"];
  const changeHandler = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (
      (+ta.scrollLeft === 10 &&
        (keyEvent.key === "ArrowLeft" || keyEvent.code === "ArrowLeft")) ||
      keyEvent.key === "Home" ||
      keyEvent.code === "Home" ||
      keyEvent.key === "Enter" ||
      keyEvent.code === "Enter" ||
      keyEvent.code === "NumpadEnter"
    ) {
      ta.scrollLeft = 0;
    }
    updateLineNumbers(ta, wrapper);
  };

  for (const evt of changeEvents) {
    ta.addEventListener(evt, changeHandler);
    listeners.push({ evt, hdlr: changeHandler });
  }

  const scrollEvents = ["change", "mousewheel", "scroll"];
  const scrollHandler = () => {
    wrapper.scrollTop = ta.scrollTop;
  };

  for (const evt of scrollEvents) {
    ta.addEventListener(evt, scrollHandler);
    listeners.push({ evt, hdlr: scrollHandler });
  }
};

export const removeLineNumbers = (ta: HTMLTextAreaElement) => {
  if (!ta || !ta.classList.contains("tln-active")) return;
  ta.classList.remove("tln-active");

  const wrapper = ta.previousSibling;
  if (wrapper && (wrapper as HTMLElement).classList?.contains("tln-wrapper")) {
    (wrapper as HTMLElement).remove();
  }

  const listeners = eventMap.get(ta);
  if (listeners) {
    for (const { evt, hdlr } of listeners) {
      ta.removeEventListener(evt, hdlr);
    }
    eventMap.delete(ta);
  }
};
