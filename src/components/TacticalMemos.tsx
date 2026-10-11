import React, { useState } from 'react';
import { BookOpen, Plus, Tag, Clock, AlertTriangle } from 'lucide-react';

export interface MemoItem {
  id: string;
  title: string;
  content: string;
  priority: string;
  timestamp: string;
}

interface TacticalMemosProps {
  memos: MemoItem[];
  onAddMemo: (title: string, content: string, priority: string) => void;
}

export const TacticalMemos: React.FC<TacticalMemosProps> = ({ memos, onAddMemo }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    onAddMemo(newTitle, newContent, newPriority);
    setNewTitle('');
    setNewContent('');
    setShowAddForm(false);
  };

  const getPriorityBadge = (p: string) => {
    switch (p.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'bg-red-950/60 border-red-500/40 text-red-300';
      case 'low':
        return 'bg-slate-900/60 border-slate-700/40 text-slate-300';
      default:
        return 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300';
    }
  };

  return (
    <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3.5 backdrop-blur-md flex flex-col h-full">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-cyan-900/40">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-400" />
          <span className="font-mono-tech text-xs tracking-wider text-cyan-200 uppercase">
            Holographic Tactical Archive ({memos.length})
          </span>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs font-tech text-cyan-300 hover:text-white flex items-center gap-1 border border-cyan-500/30 px-2 py-0.5 rounded bg-cyan-950/40"
        >
          <Plus className="w-3 h-3" />
          <span>{showAddForm ? 'Cancel' : 'New Note'}</span>
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-3 p-2.5 rounded-lg bg-slate-900/70 border border-cyan-900/40 space-y-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Memo Title (e.g. Vibranium Mesh Test)"
            className="w-full bg-slate-950 border border-cyan-900/50 rounded px-2.5 py-1 text-xs text-cyan-100 font-tech focus:outline-none focus:border-cyan-400"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Technical details or tactical observation..."
            rows={2}
            className="w-full bg-slate-950 border border-cyan-900/50 rounded px-2.5 py-1 text-xs text-cyan-100 font-tech focus:outline-none focus:border-cyan-400 resize-none"
          />
          <div className="flex items-center justify-between">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="bg-slate-950 border border-cyan-900/50 rounded px-2 py-0.5 text-xs text-cyan-200 font-tech"
            >
              <option value="low">Low Priority</option>
              <option value="normal">Normal Priority</option>
              <option value="high">High Priority</option>
              <option value="critical">Critical</option>
            </select>
            <button
              type="submit"
              className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono-tech font-bold text-[10px] rounded uppercase"
            >
              Log Memo
            </button>
          </div>
        </form>
      )}

      {/* Memos List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-56">
        {memos.length === 0 ? (
          <div className="text-center text-cyan-500/40 text-xs py-4 font-tech">
            No tactical memos recorded. Say "J.A.R.V.I.S., take a memo" to record one by voice.
          </div>
        ) : (
          memos.map((memo) => (
            <div
              key={memo.id}
              className="p-2.5 rounded-lg bg-slate-900/60 border border-cyan-900/30 hover:border-cyan-500/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-tech text-xs font-bold text-cyan-100 line-clamp-1">
                  {memo.title}
                </span>
                <span
                  className={`text-[9px] font-mono-tech px-1.5 py-0.2 rounded border uppercase ${getPriorityBadge(
                    memo.priority
                  )}`}
                >
                  {memo.priority}
                </span>
              </div>
              <p className="text-[11px] text-cyan-200/80 font-sans leading-relaxed">
                {memo.content}
              </p>
              <div className="mt-1.5 flex items-center gap-1 text-[9px] font-code text-cyan-500/60">
                <Clock className="w-2.5 h-2.5" />
                <span>{memo.timestamp}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
