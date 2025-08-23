import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import API from '../api';
import { authHeader, getToken } from '../utils/auth';

const SOCKET_URL = process.env.REACT_APP_SOCKET || 'http://localhost:5000';
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function CallPage(){
  const { peerId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [peerUser, setPeerUser] = useState(loc.state?.peerUser || null);
  const [myUser, setMyUser] = useState(null);

  useEffect(() => {
    // fetch my user, peer info if needed
    API('/api/users/me', { headers: authHeader() }).then(setMyUser);
    if (!peerUser) {
      API('/api/users/search?username=', { headers: authHeader() }).catch(()=>{});
      // Alternatively you could fetch peer details via another endpoint; for now we rely on nav state.
    }
  }, []);

  useEffect(() => {
    // Init socket
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current.on('connect', () => {
      API('/api/users/me', { headers: authHeader() }).then(user => {
        if (user && user._id) socketRef.current.emit('registerSocket', user._id);
      });
    });

    socketRef.current.on('incoming-call', async ({ offer, fromUser, fromName, fromSocket }) => {
      // someone is calling me
      console.log('Incoming call from', fromUser);
      setStatus('incoming');
      // store fromSocket to answer
      socketRef.current._lastIncoming = { fromSocket, fromUser, fromName, offer };
    });

    socketRef.current.on('call-accepted', async ({ answer }) => {
      // remote accepted our offer
      console.log('call accepted, setting remote desc');
      await pcRef.current.setRemoteDescription(answer);
      setStatus('in-call');
    });

    socketRef.current.on('ice-candidate', async ({ candidate }) => {
      if (candidate && pcRef.current) {
        try { await pcRef.current.addIceCandidate(candidate); } catch (e) { console.warn(e); }
      }
    });

    socketRef.current.on('call-ended', () => {
      endCall();
      alert('Call ended by other user');
    });

    return () => socketRef.current.disconnect();
    // eslint-disable-next-line
  }, []);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = e => {
      if (e.candidate) {
        socketRef.current.emit('ice-candidate', { toSocket: socketRef.current._remoteSocket, candidate: e.candidate });
      }
    };
    pc.ontrack = e => {
      // play remote
      remoteAudioRef.current.srcObject = e.streams[0];
    };
    pcRef.current = pc;
  };

  const startLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    // add tracks to peer connection
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
  };

  // Caller flow
  const callUser = async () => {
    try {
      setStatus('calling');
      createPeerConnection();
      await startLocalStream();

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      // get peer socket from server mapping: we only know peerId => server maps to socketId
      socketRef.current.emit('call-user', {
        toUserId: peerId,
        offer: pcRef.current.localDescription,
        fromUser: myUser? myUser._id : null,
        fromName: myUser? myUser.username : 'Unknown'
      });

      // server will emit incoming-call to callee. We expect call-accepted returned to our socket with answer.
      // But we need to know remote socket id to send ICE to; server will respond with call-accepted event including fromSocket,
      // however we set socketRef.current._remoteSocket when server returns call-accepted in our handler.
    } catch (err) {
      console.error(err); setStatus('error'); alert('Call failed');
    }
  };

  // Answer flow (when you received incoming)
  const acceptCall = async () => {
    try {
      setStatus('connecting');
      const incoming = socketRef.current._lastIncoming;
      if (!incoming) { alert('No incoming call'); return; }
      createPeerConnection();
      await startLocalStream();

      // remote offer
      await pcRef.current.setRemoteDescription(incoming.offer);

      // create answer
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      // save the remote socket id so our ICE messages can reach the caller
      socketRef.current._remoteSocket = incoming.fromSocket;

      // send the answer back to the caller
      socketRef.current.emit('answer-call', { toSocket: incoming.fromSocket, answer: pcRef.current.localDescription });

      setStatus('in-call');
    } catch (err) {
      console.error(err); setStatus('error');
    }
  };

  // End call
  const endCall = () => {
    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(s => {
          try { s.track.stop(); } catch {}
        });
        pcRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    } catch (e) {}
    pcRef.current = null;
    localStreamRef.current = null;
    setStatus('ended');
    // notify remote
    if (socketRef.current && socketRef.current._remoteSocket) {
      socketRef.current.emit('end-call', { toSocket: socketRef.current._remoteSocket });
    }
    // back to dashboard after small delay
    setTimeout(() => nav('/'), 800);
  };

  // When we are caller, server will later send us call-accepted with answer; server also includes fromSocket so we can send ICE.
  useEffect(() => {
    // when call accepted, socket handler sets remote description
    // also capture remote socket in the 'call-accepted' handler via wrapper
    socketRef.current?.on('call-accepted', ({ answer, fromSocket }) => {
      socketRef.current._remoteSocket = fromSocket;
    });
    return () => {};
  }, []);

  // UI
  return (
    <div className="call-page">
      <h3>Call with {peerUser ? peerUser.username : (peerId || '')}</h3>
      <p>Status: {status}</p>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="call-controls">
        {status === 'starting' && <button onClick={callUser}>Call</button>}
        {status === 'incoming' && <button onClick={acceptCall}>Accept</button>}
        {(status === 'in-call' || status === 'calling' || status === 'connecting') && <button onClick={endCall}>End Call</button>}
      </div>
    </div>
  );
}
