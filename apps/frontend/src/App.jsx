import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import "./App.css";

const PHONE_NUMBER = import.meta.env.VITE_MOCK_PHONE || "919999999999";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const initialMessages = [
  {
    id: "welcome",
    direction: "in",
    body: "Hi there! 👋 I'm your travel planner. Let's find your next adventure together.",
    at: Date.now(),
  },
];

function Icon({ name, className }) {
  const common = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  if (name === "back") {
    return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  }
  if (name === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
  }
  if (name === "more") {
    return <svg {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
  }
  if (name === "paperclip") {
    return <svg {...common}><path d="m20.5 11.5-8.6 8.6a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>;
  }
  if (name === "smile") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></svg>;
  }
  if (name === "send") {
    return <svg {...common}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
  }
  return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19l1-4.5A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8.5 9.5c.8 2 2 3.2 4 4" /></svg>;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function buttonLabel(button) {
  if (typeof button === "string") return button;
  return button.title ?? button.label ?? button.body ?? button.text ?? "";
}

function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messageEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isTyping]);

  async function sendMessage(value) {
    const body = value.trim();
    if (!body || isTyping) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, direction: "out", body, at: Date.now() },
    ]);
    setDraft("");
    setIsTyping(true);

    try {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const response = await fetch(`${API_URL}/api/webhook/mock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: PHONE_NUMBER, body }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Request failed (${response.status})`);
      }

      const replies = Array.isArray(result.replies) && result.replies.length
        ? result.replies
        : result.reply
          ? [{ body: result.reply }]
          : [];

      setMessages((current) => [
        ...current,
        ...replies.map((reply, index) => ({
          id: reply.id ?? `reply-${Date.now()}-${index}`,
          direction: "in",
          body: reply.body ?? "",
          at: reply.at ?? Date.now(),
          buttons: reply.buttons,
        })).filter((reply) => reply.body),
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          direction: "in",
          body: `I couldn't reach the travel service. ${error.message}`,
          at: Date.now(),
          isError: true,
        },
      ]);
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage(draft);
  }

  return (
    <main className="app-shell flex min-h-screen items-center justify-center p-0 sm:p-6">
      <section className="chat-window flex h-screen w-full max-w-[1440px] overflow-hidden bg-white shadow-2xl sm:h-[min(900px,calc(100vh-48px))] sm:rounded-xl">
        <aside className="hidden w-[340px] shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
          <div className="flex h-[72px] items-center justify-between bg-wa-panel px-5">
            <div className="flex items-center gap-3">
              <div className="avatar avatar-you">Y</div>
              <span className="font-semibold text-slate-700">Your chats</span>
            </div>
            <button className="icon-button text-slate-500" type="button" aria-label="Search chats">
              <Icon name="search" className="h-5 w-5" />
            </button>
          </div>
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400">
              <Icon name="search" className="h-4 w-4" />
              <span>Search or start a new chat</span>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-slate-100 bg-emerald-50/50 px-4 py-4">
            <div className="avatar avatar-bot"><Icon name="chat" className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold text-slate-800">Travel Assistant</p>
                <span className="text-[11px] text-slate-400">now</span>
              </div>
              <p className="truncate text-sm text-slate-500">Let&apos;s plan your next trip ✈️</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-auto border-t border-slate-100 px-5 py-4 text-center text-xs text-slate-400">
            Your travel plans, all in one place
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="z-10 flex h-[72px] shrink-0 items-center gap-3 bg-wa-header px-3 text-white shadow-sm sm:px-5">
            <button className="icon-button -ml-1 md:hidden" type="button" aria-label="Back">
              <Icon name="back" className="h-6 w-6" />
            </button>
            <div className="avatar avatar-bot avatar-header"><Icon name="chat" className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold leading-tight">Travel Assistant</h1>
              <p className="mt-1 text-xs text-emerald-100">{isTyping ? "typing…" : "online"}</p>
            </div>
            <button className="icon-button" type="button" aria-label="Search conversation">
              <Icon name="search" className="h-5 w-5" />
            </button>
            <button className="icon-button" type="button" aria-label="More options">
              <Icon name="more" className="h-5 w-5" />
            </button>
          </header>

          <div className="chat-wallpaper flex-1 overflow-y-auto px-3 py-5 sm:px-8 sm:py-7" aria-live="polite">
            <div className="mx-auto mb-5 max-w-max rounded-lg bg-[#fff9c4] px-3 py-2 text-center text-[11px] leading-relaxed text-slate-600 shadow-sm">
              Messages are private to this demo. Tell us where you&apos;d like to go to get started.
            </div>
            <div className="mx-auto flex max-w-[820px] flex-col gap-2.5">
              {messages.map((message) => {
                const outgoing = message.direction === "out";
                return (
                  <div key={message.id} className={clsx("flex", outgoing ? "justify-end" : "justify-start")}>
                    <article className={clsx(
                      "message-bubble relative max-w-[88%] px-3 pb-2 pt-2.5 text-[14px] leading-[1.45] shadow-sm sm:max-w-[75%] sm:px-3.5",
                      outgoing ? "bg-wa-bubbleIn" : "bg-wa-bubbleOut",
                      message.isError && "border border-rose-200 bg-rose-50",
                    )}>
                      <p className="whitespace-pre-wrap break-words pr-12">{message.body}</p>
                      <time className="absolute bottom-1.5 right-2.5 text-[10px] text-slate-500">
                        {formatTime(message.at)}
                      </time>
                      {Array.isArray(message.buttons) && message.buttons.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-black/10 pt-2">
                          {message.buttons.map((button, index) => {
                            const label = buttonLabel(button);
                            return label ? (
                              <button
                                key={button.id ?? `${label}-${index}`}
                                type="button"
                                disabled={isTyping}
                                onClick={() => sendMessage(label)}
                                className="rounded-full border border-wa-teal/40 bg-white/80 px-3 py-1.5 text-xs font-medium text-wa-teal transition hover:bg-white disabled:opacity-50"
                              >
                                {label}
                              </button>
                            ) : null;
                          })}
                        </div>
                      )}
                    </article>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-wa-bubbleIn px-4 py-3 shadow-sm" role="status" aria-label="Travel Assistant is typing">
                    <span className="typing-dot" />
                    <span className="typing-dot animation-delay-150" />
                    <span className="typing-dot animation-delay-300" />
                  </div>
                </div>
              )}
              <div ref={messageEndRef} />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex shrink-0 items-end gap-2 bg-wa-panel px-3 py-3 sm:gap-3 sm:px-5 sm:py-4">
            <button className="icon-button mb-1 text-slate-500" type="button" aria-label="Add attachment">
              <Icon name="paperclip" className="h-5 w-5" />
            </button>
            <button className="icon-button mb-1 hidden text-slate-500 sm:flex" type="button" aria-label="Add emoji">
              <Icon name="smile" className="h-5 w-5" />
            </button>
            <label className="sr-only" htmlFor="message-input">Message</label>
            <textarea
              ref={inputRef}
              id="message-input"
              rows="1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit(event);
                }
              }}
              placeholder="Type a message"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-lg border-0 bg-white px-4 py-3 text-sm leading-5 text-slate-800 outline-none ring-0 placeholder:text-slate-400 focus:ring-2 focus:ring-wa-teal/30"
            />
            <button
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white transition hover:bg-wa-header disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={!draft.trim() || isTyping}
              aria-label="Send message"
            >
              <Icon name="send" className="h-[18px] w-[18px]" />
            </button>
          </form>
          <p className="hidden bg-wa-panel pb-2 text-center text-[10px] text-slate-400 sm:block">Press Enter to send · Shift + Enter for a new line</p>
        </div>
      </section>
    </main>
  );
}

export default App;
