import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import API from '../api';
import { authHeader } from '../utils/auth';

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
  const [incomingCall, setIncomingCall] = useState(null); // store caller info

  const iceQueueRef = useRef([]);
  const setRemoteSocket = (sockId) => {
    socketRef.current._remoteSocket = sockId;
    if (iceQueueRef.current.length) {
      iceQueueRef.current.forEach(c =>
        socketRef.current.emit('ice-candidate', { toSocket: sockId, candidate: c })
      );
      iceQueueRef.current = [];
    }
  };

  useEffect(() => {
    API('/api/users/me', { headers: authHeader() }).then(setMyUser).catch(()=>{});
  }, []);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current.on('connect', () => {
      API('/api/users/me', { headers: authHeader() }).then(user => {
        if (user && user._id) socketRef.current.emit('registerSocket', user._id);
      });
    });

    // Incoming call handler
    socketRef.current.on('incoming-call', async ({ offer, fromUser, fromName, fromSocket }) => {
      console.log('[Signaling] Incoming call from', fromName);
      setIncomingCall({ fromUser, fromName, fromSocket, offer });
      setStatus('incoming');
    });

    socketRef.current.on('call-accepted', async ({ answer, fromSocket }) => {
      try {
        setRemoteSocket(fromSocket);
        await pcRef.current.setRemoteDescription(answer);
        setStatus('in-call');
      } catch (e) {
        console.error('Error applying remote answer', e);
      }
    });

    socketRef.current.on('call-rejected', () => {
      alert('Your call was rejected');
      endCall();
    });

    socketRef.current.on('ice-candidate', async ({ candidate, fromSocket }) => {
      try {
        if (candidate && pcRef.current) {
          await pcRef.current.addIceCandidate(candidate);
          if (!socketRef.current._remoteSocket && fromSocket) setRemoteSocket(fromSocket);
        }
      } catch (e) {
        console.warn('Error adding remote ICE', e);
      }
    });

    socketRef.current.on('call-ended', () => {
      endCall();
      alert('Call ended by other user');
    });

    return () => socketRef.current.disconnect();
  }, []);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = e => {
      if (e.candidate) {
        const remoteSock = socketRef.current._remoteSocket;
        if (remoteSock) {
          socketRef.current.emit('ice-candidate', { toSocket: remoteSock, candidate: e.candidate });
        } else {
          iceQueueRef.current.push(e.candidate);
        }
      }
    };
    pc.ontrack = e => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(err => console.warn('Autoplay blocked:', err));
      }
    };
    pcRef.current = pc;
  };

  const startLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
  };

  const callUser = async () => {
    try {
      setStatus('calling');
      createPeerConnection();
      await startLocalStream();
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socketRef.current.emit('call-user', {
        toUserId: peerId,
        offer: pcRef.current.localDescription,
        fromUser: myUser?._id,
        fromName: myUser?.username || 'Unknown'
      });
    } catch (err) {
      console.error(err); setStatus('error'); alert('Call failed');
    }
  };

  const acceptCall = async () => {
    try {
      if (!incomingCall) return;
      setStatus('connecting');
      createPeerConnection();
      await startLocalStream();
      await pcRef.current.setRemoteDescription(incomingCall.offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      setRemoteSocket(incomingCall.fromSocket);
      socketRef.current.emit('answer-call', {
        toSocket: incomingCall.fromSocket,
        answer: pcRef.current.localDescription
      });
      setIncomingCall(null);
      setStatus('in-call');
    } catch (err) {
      console.error(err); setStatus('error');
    }
  };

  const rejectCall = () => {
    if (incomingCall) {
      socketRef.current.emit('reject-call', { toSocket: incomingCall.fromSocket });
      setIncomingCall(null);
      setStatus('idle');
    }
  };

  const endCall = () => {
    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach(s => { try { s.track.stop(); } catch {} });
        pcRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    } catch {}
    pcRef.current = null;
    localStreamRef.current = null;
    setStatus('ended');
    if (socketRef.current && socketRef.current._remoteSocket) {
      socketRef.current.emit('end-call', { toSocket: socketRef.current._remoteSocket });
    }
    setTimeout(() => nav('/'), 800);
  };

  return (
    <div className="call-page">
      <h3>Call with {peerUser ? peerUser.username : peerId}</h3>
      <p>Status: {status}</p>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Incoming call popup */}
      {status === 'incoming' && incomingCall && (
        <div className="incoming-popup">
          <p>{incomingCall.fromName} is calling you...</p>
          <button onClick={acceptCall}>Accept</button>
          <button onClick={rejectCall}>Reject</button>
        </div>
      )}

      {/* Controls */}
      <div className="call-controls">
        {status === 'starting' && <button onClick={callUser}>Call</button>}
        {(status === 'in-call' || status === 'calling' || status === 'connecting') &&
          <button onClick={endCall}>End Call</button>}
      </div>
    </div>
  );
}
