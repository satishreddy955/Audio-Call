import React, { useEffect, useState, useRef } from 'react';
import API from '../api';
import { getToken, authHeader, removeToken } from '../utils/auth';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET || 'https://audio-call-fs74.onrender.com';

export default function Dashboard(){
  const nav = useNavigate();
  const [me, setMe] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { nav('/login'); return; }
    API('/api/users/me', { headers: authHeader() }).then(setMe).catch(()=>nav('/login'));

    // init socket and register userId
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current.on('connect', () => {
      // fetch user id from token payload? we have no decode helper here so ask backend for /me
      API('/api/users/me', { headers: authHeader() }).then(user => {
        if (user && user._id) socketRef.current.emit('registerSocket', user._id);
      });
    });

    socketRef.current.on('incoming-call', ({ fromUser, fromName }) => {
      // optional: realtime notification could be shown here
      alert(`Incoming call from ${fromName} (username: ${fromUser})`);
    });

    return () => socketRef.current.disconnect();
  }, [nav]);

  const logout = () => { removeToken(); nav('/login'); };

  const search = async e => {
    e.preventDefault();
    if (!q) return;
    const list = await API('/api/users/search?username=' + encodeURIComponent(q), { headers: authHeader() });
    setResults(list || []);
  };

  const startCall = async (user) => {
    // redirect to call page with user._id as peerId
    nav(`/call/${user._id}`, { state: { peerUser: user } });
  };

  return (
    <div className="dashboard">
      <header>
        <h2>Welcome {me?.username}</h2>
        <div>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      <section className="search">
        <form onSubmit={search}>
          <input placeholder="Search username" value={q} onChange={e=>setQ(e.target.value)} />
          <button>Search</button>
        </form>
        <div className="results">
          {results.map(u => (
            <div key={u._id} className="user-row">
              <div>{u.username} — {u.email}</div>
              <button onClick={()=>startCall(u)}>Call</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
