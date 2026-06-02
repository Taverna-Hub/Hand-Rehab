#pragma once

#include <Arduino.h>

// Estrategia comparativa academica: remove o primeiro elemento deslocando todos
// os demais uma posicao para a esquerda. O custo de remocao e O(n).
template <typename T, size_t Capacity>
class InefficientShiftBuffer {
 public:
  bool push(const T &item) {
    if (count_ == Capacity) {
      dropped_samples_++;
      return false;
    }

    data_[count_] = item;
    count_++;
    return true;
  }

  bool pop(T &item) {
    if (count_ == 0) {
      return false;
    }

    item = data_[0];
    for (size_t i = 1; i < count_; i++) {
      data_[i - 1] = data_[i];
    }
    count_--;
    return true;
  }

  size_t size() const { return count_; }
  size_t capacity() const { return Capacity; }
  uint32_t dropped_samples() const { return dropped_samples_; }

  void clear() {
    count_ = 0;
    dropped_samples_ = 0;
  }

 private:
  T data_[Capacity];
  size_t count_ = 0;
  uint32_t dropped_samples_ = 0;
};
