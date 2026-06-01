#pragma once

#include <Arduino.h>

template <typename T, size_t Capacity>
class RingBuffer {
 public:
  bool push(const T &item) {
    if (count_ == Capacity) {
      dropped_samples_++;
      return false;
    }

    data_[head_] = item;
    head_ = (head_ + 1) % Capacity;
    count_++;
    return true;
  }

  bool pop(T &item) {
    if (count_ == 0) {
      return false;
    }

    item = data_[tail_];
    tail_ = (tail_ + 1) % Capacity;
    count_--;
    return true;
  }

  bool peek(size_t offset, T &item) const {
    if (offset >= count_) {
      return false;
    }

    item = data_[(tail_ + offset) % Capacity];
    return true;
  }

  size_t discard(size_t items) {
    const size_t discarded = items > count_ ? count_ : items;
    tail_ = (tail_ + discarded) % Capacity;
    count_ -= discarded;
    return discarded;
  }

  size_t size() const { return count_; }
  size_t capacity() const { return Capacity; }
  bool empty() const { return count_ == 0; }
  uint32_t dropped_samples() const { return dropped_samples_; }

  void clear() {
    head_ = 0;
    tail_ = 0;
    count_ = 0;
    dropped_samples_ = 0;
  }

 private:
  T data_[Capacity];
  size_t head_ = 0;
  size_t tail_ = 0;
  size_t count_ = 0;
  uint32_t dropped_samples_ = 0;
};
