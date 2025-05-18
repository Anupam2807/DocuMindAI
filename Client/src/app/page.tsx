"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { Upload, Send, FileText, Trash2, Bot, User, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useUser,SignOutButton,UserButton } from '@clerk/nextjs';

type StoredDocument = {
  filename: string;
  uploadDate: string;
  source: string;
};

export default function Home() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<
    {
      name: string;
      jobId: string;
      status: "pending" | "completed" | "failed";
    }[]
  >([]);
  const [previouslyUploadedDocs, setPreviouslyUploadedDocs] = useState<StoredDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);
  const [docsLoadError, setDocsLoadError] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{show: boolean, filename: string | null}>({show: false, filename: null});

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const { user } = useUser();
  const {
    messages,
    input,
    handleInputChange,
    isLoading,
    setMessages,
    setInput,
  } = useChat();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (user?.id) {
      fetchUserDocuments();
    }
  }, [user?.id]);

  const fetchUserDocuments = async () => {
    setIsLoadingDocs(true);
    setDocsLoadError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/upload/user-pdfs?userId=${user?.id}`
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.documents)) {
        setPreviouslyUploadedDocs(data.documents);
      } else {
        setPreviouslyUploadedDocs([]);
      }
    } catch (error) {
      console.error('Error fetching user documents:', error);
      setDocsLoadError('Unable to load your documents. Please try again later.');
      setPreviouslyUploadedDocs([]);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (!user?.id) return;
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/upload/delete-document`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          filename: filename
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
      
      const data = await response.json();
      
      if (data.success) {
        setPreviouslyUploadedDocs(prev => 
          prev.filter(doc => doc.filename !== filename)
        );
        setDeleteModal({show: false, filename: null});
      } else {
        alert(data.error || 'Failed to delete document');
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Error deleting document. Please try again later.');
    }
  };

  const confirmDelete = (filename: string) => {
    setDeleteModal({show: true, filename});
  };

  const canChat =
    !isUploading && uploadedFiles.every((f) => f.status !== "pending");

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("userId", user?.id || '');
    
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/upload/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      console.error("Upload failed");
      setIsUploading(false);
      return;
    }
    const { jobId } = await res.json();

    setUploadedFiles((prev) => [
      ...prev,
      { name: file.name, jobId, status: "pending" },
    ]);

    const pollStatus = async () => {
      const statusRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/upload-status?jobId=${jobId}`
      );
      const { status } = await statusRes.json();
      if (status === "completed" || status === "failed") {
        if (status === "completed") {
          setUploadedFiles((prev) => 
            prev.filter(f => f.jobId !== jobId)
          );
          fetchUserDocuments();
        } else {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.jobId === jobId ? { ...f, status } : f))
          );
        }
        setIsUploading(false);
      } else {
        setTimeout(pollStatus, 2000);
      }
    };
    pollStatus();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    for (const file of files) {
      await handleFileUpload(file);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleRemoveFile = (jobId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.jobId !== jobId));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canChat) return;
    const form = e.currentTarget;
    const input = form.querySelector('input[type="text"]') as HTMLInputElement;
    const message = input.value;
    if (!message) return;
    setIsThinking(true);
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), role: "user", content: message },
    ]);
    input.value = "";
    setInput("");
    try {
      const result = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/info?q=${encodeURIComponent(message)}&userId=${user?.id}`,
        {
          method: "GET",
        }
      );
      const data = await result.json();
      const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "");

      const assistantReply =
        stripHtml(data.answer) || "Sorry, I didn't understand that.";

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: assistantReply,
        },
      ]);
      setIsThinking(false);

      setFiles(null);
    } catch (e) {
      console.log("error", e);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: "Oops! Something went wrong. Please try again.",
        },
      ]);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <main className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {deleteModal.show && deleteModal.filename && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Confirm Deletion</h3>
              <button 
                onClick={() => setDeleteModal({show: false, filename: null})}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Are you sure you want to delete "{deleteModal.filename}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal({show: false, filename: null})}
                className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteDocument(deleteModal.filename!)}
                className="px-4 py-2 rounded-md bg-red-500 hover:bg-red-600 text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-[30vw] border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-md p-6 flex flex-col">
        <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-purple-600 to-blue-500 bg-clip-text text-transparent">
          Documents
        </h2>

        <Card className="p-6 mb-6 border-none shadow-lg bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900">
          <div className="flex flex-col items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf"
              multiple
            />
            <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
              <Upload
                className="text-purple-600 dark:text-purple-400"
                size={24}
              />
            </div>
            <Button
              onClick={handleUploadClick}
              className="w-full flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-700 hover:to-blue-600 text-white"
              disabled={isUploading}
            >
              {isUploading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Uploading...
                </div>
              ) : (
                <>Upload PDF</>
              )}
            </Button>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              Upload PDF files to chat about their contents
            </p>
          </div>
        </Card>

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Your Documents
          </h3>
          <Badge
            variant="outline"
            className="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
          >
            {uploadedFiles.length + previouslyUploadedDocs.length} files
          </Badge>
        </div>

        <Separator className="mb-4 bg-gray-200 dark:bg-gray-700" />

        <ScrollArea className="flex-1 pr-4">
          {isLoadingDocs ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <div className="h-6 w-6 rounded-full border-2 border-purple-500 border-t-transparent animate-spin mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading your documents...
              </p>
            </div>
          ) : docsLoadError ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                <FileText className="text-red-500" size={20} />
              </div>
              <p className="text-sm text-red-500 dark:text-red-400">
                {docsLoadError}
              </p>
              <Button 
                onClick={fetchUserDocuments}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                Try Again
              </Button>
            </div>
          ) : uploadedFiles.length > 0 || previouslyUploadedDocs.length > 0 ? (
            <div className="space-y-3">
              {/* Show currently uploading files */}
              {uploadedFiles.map((f, index) => (
                <motion.div
                  key={f.jobId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <FileText
                        className="text-blue-500 dark:text-blue-400"
                        size={16}
                      />
                    </div>
                    <span className="text-sm font-medium truncate max-w-[160px]">
                      {f.name}
                    </span>
                    <Badge>
                      {f.status === "pending"
                        ? "Processing…"
                        : f.status === "completed"
                        ? "Ready"
                        : "Failed"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveFile(f.jobId)}
                    disabled={f.status === "pending"}
                    className="h-8 w-8 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
              
              {previouslyUploadedDocs.map((doc, index) => (
                <motion.div
                  key={doc.filename + index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <FileText
                        className="text-green-500 dark:text-green-400"
                        size={16}
                      />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium truncate max-w-[160px]">
                        {doc.filename}
                      </span>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(doc.uploadDate)}
                      </span>
                    </div>
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                      Ready
                    </Badge>
                  </div>
                  {/* <Button
                    variant="ghost"
                    // size="icon"
                    onClick={() => confirmDelete(doc.filename)}
                    className="h-8 w-8 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button> */}
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                <FileText className="text-gray-400" size={20} />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No files uploaded yet
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Upload PDFs to start chatting
              </p>
            </div>
          )}
        </ScrollArea>

        <div className="mt-4 pt-6  border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <UserButton   />
      </div>

      </div>

      {/* Chat Main Area */}
      <div className="w-[70vw] flex flex-col h-full bg-gray-50 dark:bg-gray-900">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-500 bg-clip-text text-transparent">
            DocuMind AI
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Ask questions about your uploaded documents
          </p>

        </div>

        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6 max-h-[200px] max-w-4xl mx-auto">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div className="flex gap-3 max-w-[80%]">
                  {message.role === "assistant" && (
                    <Avatar className="h-8 w-8 border-2 border-purple-200 dark:border-purple-900">
                      <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                        <Bot size={16} />
                      </AvatarFallback>
                    </Avatar>
                  )}

                  <div
                    className={`p-4 rounded-2xl ${
                      message.role === "user"
                        ? "bg-gradient-to-r from-purple-600 to-blue-500 text-white"
                        : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>

                  {message.role === "user" && (
                    <Avatar className="h-8 w-8 border-2 border-blue-200 dark:border-blue-900">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                        <User size={16} />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              </motion.div>
            ))}

            {isThinking && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="flex gap-3 max-w-[80%] items-center">
                  {/* assistant avatar */}
                  <Avatar className="h-8 w-8 border-2 border-purple-200 dark:border-purple-900">
                    <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                      <Bot size={16} />
                    </AvatarFallback>
                  </Avatar>

                  {/* spinner bubble */}
                  <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 flex items-center">
                    {" "}
                    <div className="h-4 w-4 border-2 border-t-transparent border-purple-500 rounded-full animate-spin" />
                  </div>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <form onSubmit={onSubmit} className="flex gap-3 max-w-4xl mx-auto">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder={
                canChat
                  ? "Ask a question related to your document"
                  : "Wait for files to process…"
              }
              disabled={!canChat}
              className="flex-1 p-3 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <Button
              type="submit"
              disabled={!canChat || isLoading}
              className="rounded-full bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-700 hover:to-blue-600 text-white px-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Thinking...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Send size={16} />
                  Send
                </div>
              )}
            </Button> 
          </form>
        </div>
      </div>
    </main>
  );
}
